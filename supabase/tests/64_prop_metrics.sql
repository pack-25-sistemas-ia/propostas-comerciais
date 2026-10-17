-- Indicadores (docs/METRICS.md) com fixtures determinísticas. Valores esperados calculados À MÃO.
-- Org A: A (owner), S1 e S2 (vendedores), V (leitor). Org B: B (owner), usada nas bordas do período.
-- Linha do tempo (dias antes de hoje, em Brasília), hoje = T:
--   P1 S1/C1 1000,10 produto  enviada T-20, aceita T-18      P5 S2/C1 1500,00  enviada T-6, visualizada (aberta, vence T+5)
--   P2 S1/C1 2000,20          enviada T-15, aceita T-10      P6 S2/C2  700,00  enviada T-40, aceita T-35 (fora de 30 dias)
--   P3 S1/C2  500,05          enviada T-12, aceita T-5       P7 S1/C1  rascunho criado T-2
--   P4 S2/C2  300,00          enviada T-9,  recusada T-3     P8 S2/C1  900,00  enviada T-50, expirada (venceu T-20)

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_s2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000002","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000003","aal":"aal1"}'', true); set local role authenticated;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@met.invalid'), ('ffffffff-0000-4000-8000-00000000000b', 'b@met.invalid'),
  ('ffffffff-0000-4000-8000-000000000001', 'vendedor.um@met.invalid'), ('ffffffff-0000-4000-8000-000000000002', 'vendedor.dois@met.invalid'),
  ('ffffffff-0000-4000-8000-000000000003', 'v@met.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('Métricas A', 'metricas-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-000000000001', 'member'), (a, 'ffffffff-0000-4000-8000-000000000002', 'member'), (a, 'ffffffff-0000-4000-8000-000000000003', 'viewer');
  insert into public.clients (organization_id, name) values (a, 'Cliente C1'), (a, 'Cliente C2');
  perform set_config('t.a', a::text, true);
end $$;
reset role;
:as_b
do $$ begin perform set_config('t.b', public.create_organization('Métricas B', 'metricas-b')::text, true); end $$;
reset role;

-- ---------- ferramentas de fixture (superusuário; o que se prova é a leitura sob RLS) ----------
-- Sem horário explícito, usa «agora menos 1 minuto» do dia pedido: a idade em dias (floor) fica exata a qualquer hora em que o teste/seed rode.
create function test.d(p_days_ago int, p_time time default null) returns timestamptz language sql stable as $fn$
  select (((now() at time zone 'America/Sao_Paulo')::date - p_days_ago)::timestamp
    + coalesce(p_time, case when (now() at time zone 'America/Sao_Paulo')::time < time '00:02' then time '00:00' else (now() at time zone 'America/Sao_Paulo')::time - interval '1 minute' end)) at time zone 'America/Sao_Paulo'
$fn$;
create function test.mk(p_owner uuid, p_client uuid, p_title text, p_price bigint, p_type text, p_created int, p_sent int, p_valid int default 30, p_publish boolean default true)
returns uuid language plpgsql as $$
declare pid uuid; rid uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_owner, 'aal', 'aal2')::text, true);
  pid := public.prop_create_proposal(p_client, p_title);
  rid := (select current_revision_id from public.proposals where id = pid);
  perform public.prop_save_draft(rid, jsonb_build_object('valid_until', (now() at time zone 'America/Sao_Paulo')::date + greatest(p_valid, 1),
    'items', jsonb_build_array(jsonb_build_object('item_type', p_type, 'name', 'Item', 'quantity', '1', 'unit_price_cents', p_price))));
  if p_publish then perform public.prop_publish_revision(rid); end if;
  perform set_config('session_replication_role', 'replica', true);
  update public.proposals set created_at = test.d(p_created), first_sent_at = case when p_publish then test.d(p_sent) end where id = pid;
  update public.proposal_events set created_at = test.d(p_created) where proposal_id = pid and event_type = 'created';
  update public.proposal_events set created_at = test.d(p_sent) where proposal_id = pid and event_type in ('published', 'sent');
  perform set_config('session_replication_role', 'origin', true);
  return pid;
end $$;
create function test.decide(p_proposal uuid, p_decision text, p_at timestamptz) returns void language plpgsql as $$
declare rid uuid := (select published_revision_id from public.proposals where id = p_proposal); org uuid := (select organization_id from public.proposals where id = p_proposal);
begin
  perform set_config('session_replication_role', 'replica', true);
  insert into public.proposal_decisions (organization_id, proposal_id, revision_id, decision, client_name, client_email, created_at)
  values (org, p_proposal, rid, p_decision::public.proposal_decision_kind, 'Fulano', 'f@x.invalid', p_at);
  update public.proposals set status = p_decision::public.proposal_status where id = p_proposal;
  insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, created_at) values (org, p_proposal, rid, p_decision, p_at);
  perform set_config('session_replication_role', 'origin', true);
end $$;
create table test.ids (name text primary key, id uuid not null);

do $$
declare
  a uuid := current_setting('t.a')::uuid; s1 uuid := 'ffffffff-0000-4000-8000-000000000001'; s2 uuid := 'ffffffff-0000-4000-8000-000000000002';
  c1 uuid := (select id from public.clients where name = 'Cliente C1'); c2 uuid := (select id from public.clients where name = 'Cliente C2');
  p uuid;
begin
  p := test.mk(s1, c1, 'P1', 100010, 'product', 21, 20); perform test.decide(p, 'accepted', test.d(18)); insert into test.ids values ('p1', p);
  p := test.mk(s1, c1, 'P2', 200020, 'service', 16, 15); perform test.decide(p, 'accepted', test.d(10)); insert into test.ids values ('p2', p);
  p := test.mk(s1, c2, 'P3', 50005, 'service', 13, 12);  perform test.decide(p, 'accepted', test.d(5));  insert into test.ids values ('p3', p);
  p := test.mk(s2, c2, 'P4', 30000, 'service', 10, 9);   perform test.decide(p, 'declined', test.d(3));  insert into test.ids values ('p4', p);
  p := test.mk(s2, c1, 'P5', 150000, 'service', 7, 6, 5);
  -- P5 ganha a versão 2 (1800,00) depois do primeiro envio: o "valor proposto" fica com a v1; em negociação usa a v2
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'aal', 'aal2')::text, true);
  perform public.prop_create_revision(p);
  perform public.prop_save_draft((select current_revision_id from public.proposals where id = p), jsonb_build_object('items', jsonb_build_array(jsonb_build_object('item_type', 'service', 'name', 'Item', 'quantity', '1', 'unit_price_cents', 180000))));
  perform public.prop_publish_revision((select current_revision_id from public.proposals where id = p));
  update public.proposals set status = 'viewed' where id = p; insert into test.ids values ('p5', p);
  p := test.mk(s2, c2, 'P6', 70000, 'service', 41, 40);  perform test.decide(p, 'accepted', test.d(35)); insert into test.ids values ('p6', p);
  p := test.mk(s1, c1, 'P7', 12345, 'service', 2, 2, 30, false); insert into test.ids values ('p7', p);
  -- P9: rascunho arquivado (não pode aparecer em nenhum indicador)
  p := test.mk(s1, c1, 'P9', 5555, 'service', 3, 3, 30, false); update public.proposals set archived_at = now() where id = p; insert into test.ids values ('p9', p);
  p := test.mk(s2, c1, 'P8', 90000, 'service', 51, 50, 5);
  perform set_config('session_replication_role', 'replica', true);
  update public.proposal_revisions set issue_date = test.d(55)::date, valid_until = test.d(20)::date where id = (select published_revision_id from public.proposals where id = p);
  update public.proposals set status = 'expired' where id = p;
  perform set_config('session_replication_role', 'origin', true);
  insert into test.ids values ('p8', p);
  -- metas: S1 e S2, período de 30 dias com hoje no meio (decorrido 50,00%)
  insert into public.commercial_goals (organization_id, user_id, period_start, period_end, target_value_cents) values
    (a, s1, test.d(14)::date, test.d(-15)::date, 500000), (a, s2, test.d(14)::date, test.d(-15)::date, 100000);
end $$;
grant select on test.ids to authenticated;

-- ================= indicadores do período (últimos 30 dias, visão do gestor/owner) =================
:as_a
do $$
declare a uuid := current_setting('t.a')::uuid; k record; t date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into k from public.prop_kpis(a, t - 29, t);
  assert k.created_count = 6, 'criadas no período: P1-P5 e P7 = 6 (revisões não contam; P6 e P8 fora)';
  assert k.sent_count = 5, 'enviadas: P1-P5 = 5';
  assert k.accepted_count = 3 and k.accepted_cents = 350035, 'aceitas: P1+P2+P3 = 3 e 1000,10+2000,20+500,05 = 3500,35';
  assert k.declined_count = 1, 'recusadas: P4';
  assert k.acceptance_rate = 75.00, 'taxa de aceite = 3 / (3+1) = 75,00';
  assert k.avg_ticket_cents = 116678, 'ticket médio = 350035 / 3 = 116678,33 -> 116678';
  assert k.pipeline_cents = 180000 and k.pipeline_count = 1, 'em negociação: só P5, pela versão 2 (1800,00); P7 rascunho, P8 expirada e P9 arquivada fora';
  assert k.avg_days_to_decision = 5.00, 'tempo até a decisão: (2+5+7+6)/4 = 5,00 dias';
  raise notice 'PASS: seis indicadores batem com o cálculo feito à mão';
end $$;

-- filtros: vendedor, cliente, status, tipo de item
do $$
declare a uuid := current_setting('t.a')::uuid; k record; t date := (now() at time zone 'America/Sao_Paulo')::date;
  s1 uuid := 'ffffffff-0000-4000-8000-000000000001'; s2 uuid := 'ffffffff-0000-4000-8000-000000000002';
  c2 uuid := (select id from public.clients where name = 'Cliente C2');
begin
  select * into k from public.prop_kpis(a, t - 29, t, s1);
  assert k.created_count = 4 and k.sent_count = 3 and k.accepted_count = 3 and k.declined_count = 0 and k.acceptance_rate = 100.00 and k.pipeline_count = 0, 'filtro vendedor S1';
  select * into k from public.prop_kpis(a, t - 29, t, s2);
  assert k.sent_count = 2 and k.accepted_count = 0 and k.accepted_cents = 0 and k.declined_count = 1 and k.acceptance_rate = 0.00 and k.avg_ticket_cents is null and k.pipeline_cents = 180000, 'filtro vendedor S2 (taxa 0,00 com recusa; ticket sem dados)';
  select * into k from public.prop_kpis(a, t - 29, t, null, c2);
  assert k.created_count = 2 and k.sent_count = 2 and k.accepted_count = 1 and k.accepted_cents = 50005 and k.declined_count = 1 and k.acceptance_rate = 50.00 and k.pipeline_count = 0, 'filtro cliente C2';
  select * into k from public.prop_kpis(a, t - 29, t, null, null, 'accepted');
  assert k.created_count = 3 and k.sent_count = 3 and k.accepted_count = 3 and k.declined_count = 0 and k.pipeline_count = 0, 'filtro status aceita';
  select * into k from public.prop_kpis(a, t - 29, t, null, null, null, 'product');
  assert k.created_count = 1 and k.accepted_count = 1 and k.accepted_cents = 100010, 'filtro tipo de item produto: só P1';
  raise notice 'PASS: filtros por vendedor, cliente, status e tipo';
end $$;

-- sem dados: nada de zero fingindo resultado
do $$
declare a uuid := current_setting('t.a')::uuid; k record; t date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into k from public.prop_kpis(a, t - 3000, t - 2990);
  assert k.created_count = 0 and k.accepted_count = 0 and k.acceptance_rate is null and k.avg_ticket_cents is null and k.avg_days_to_decision is null, 'sem decisões: taxa, ticket e tempo nulos';
  assert k.pipeline_cents = 180000, 'em negociação é instantâneo (não depende do período)';
  assert test.throws(format($q$select * from public.prop_kpis(%L, current_date, current_date - 1)$q$, a)), 'período invertido recusado';
  assert test.throws($q$select * from public.prop_kpis(null, current_date, current_date)$q$), 'organização obrigatória';
  raise notice 'PASS: período sem dados devolve nulos, e pipeline ignora o período';
end $$;

-- séries e consistência com os indicadores
do $$
declare a uuid := current_setting('t.a')::uuid; k record; t date := (now() at time zone 'America/Sao_Paulo')::date; r record;
begin
  select * into k from public.prop_kpis(a, t - 29, t);
  select sum(created_count) c, sum(sent_count) s, sum(proposed_cents) pv, sum(accepted_count) ac, sum(declined_count) dc, sum(accepted_cents) av, count(*) n,
         bool_and(extract(isodow from bucket) = 1) all_monday
    into r from public.prop_series(a, t - 29, t);
  assert r.c = k.created_count and r.s = k.sent_count and r.ac = k.accepted_count and r.dc = k.declined_count and r.av = k.accepted_cents, 'soma da série = indicadores';
  assert r.pv = 530035, 'valor proposto = 1000,10+2000,20+500,05+300,00+1500,00 = 5300,35';
  assert r.all_monday and r.n between 5 and 6, 'semanas começam na segunda-feira';
  select count(*) n, bool_and(extract(day from bucket) = 1) first_day into r from public.prop_series(a, t - 200, t);
  assert r.first_day, 'acima de 90 dias o agrupamento é mensal (dia 1)';
  assert (select acceptance_rate from public.prop_series(a, t - 29, t) where acceptance_rate is not null order by bucket limit 1) is not null, 'taxa por bucket só onde há decisão';
  assert (select count(*) from public.prop_series(a, t - 29, t) where accepted_count + declined_count = 0 and acceptance_rate is not null) = 0, 'bucket sem decisões tem taxa nula';
  raise notice 'PASS: série temporal consistente com os indicadores';
end $$;

-- distribuição, vendedores, clientes
do $$
declare a uuid := current_setting('t.a')::uuid; t date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  assert (select jsonb_object_agg(status, proposal_count) from public.prop_status_distribution(a, t - 29, t)) = '{"draft":1,"viewed":1,"accepted":3,"declined":1}'::jsonb, 'distribuição por status das criadas no período';
  assert (select array_agg(owner_id || ':' || sent_count || ':' || accepted_count || ':' || declined_count || ':' || accepted_cents order by accepted_cents desc, owner_id) from public.prop_rep_performance(a, t - 29, t))
    = array['ffffffff-0000-4000-8000-000000000001:3:3:0:350035', 'ffffffff-0000-4000-8000-000000000002:2:0:1:0'], 'desempenho por vendedor';
  assert (select array_agg(client_name || ':' || accepted_count || ':' || accepted_cents || ':' || proposed_cents order by accepted_cents desc) from public.prop_client_ranking(a, t - 29, t))
    = array['Cliente C1:2:300030:450030', 'Cliente C2:1:50005:80005'], 'ranking de clientes (aceito e proposto)';
  assert (select count(*) from public.prop_client_ranking(a, t - 29, t, null, null, null, 1)) = 1, 'limite do ranking';
  raise notice 'PASS: distribuição por status, ranking de vendedores e de clientes';
end $$;

-- alertas
do $$
declare a uuid := current_setting('t.a')::uuid;
begin
  assert (select array_agg(kind || ':' || proposal_number || ':' || days order by kind) from public.prop_alerts(a) where kind in ('expiring', 'no_reply', 'recent_accept'))
    = array['expiring:' || (select proposal_number from public.proposals where id = (select id from test.ids where name = 'p5')) || ':5',
            'no_reply:' || (select proposal_number from public.proposals where id = (select id from test.ids where name = 'p5')) || ':6',
            'recent_accept:' || (select proposal_number from public.proposals where id = (select id from test.ids where name = 'p3')) || ':5'], 'a vencer (5 dias), sem retorno (6 dias), aceita recentemente (5 dias)';
  assert (select count(*) from public.prop_alerts(a) where kind = 'overdue') = 1 and (select days from public.prop_alerts(a) where kind = 'overdue') = 20, 'vencida: P8, 20 dias de atraso';
  assert (select count(*) from public.prop_alerts(a) where proposal_id in (select id from test.ids where name in ('p1', 'p2', 'p4', 'p7'))) = 0, 'sem alerta para decididas fora da janela e rascunhos';
  raise notice 'PASS: alertas (a vencer, vencida, sem retorno, aceita recentemente)';
end $$;
reset role;

-- limites configuráveis dos alertas
update public.proposal_settings set alert_expiring_days = 3, alert_no_reply_days = 8, alert_recent_accept_days = 2 where organization_id = current_setting('t.a')::uuid;
:as_a
do $$
declare a uuid := current_setting('t.a')::uuid;
begin
  assert (select count(*) from public.prop_alerts(a) where kind in ('expiring', 'no_reply', 'recent_accept')) = 0, 'com limites menores, nenhum alerta';
  raise notice 'PASS: limites de alerta configuráveis';
end $$;
reset role;
update public.proposal_settings set alert_expiring_days = 7, alert_no_reply_days = 5, alert_recent_accept_days = 7 where organization_id = current_setting('t.a')::uuid;

-- metas
:as_a
do $$
declare a uuid := current_setting('t.a')::uuid; g record;
begin
  select * into g from public.prop_goals_progress(a, 'ffffffff-0000-4000-8000-000000000001');
  assert g.target_cents = 500000 and g.achieved_cents = 250025 and g.pct = 50.01 and g.elapsed_pct = 50.00, 'meta S1: aceitas no período da meta (P2+P3 = 2500,25) de 5000,00 = 50,01%; decorrido 50,00%';
  select * into g from public.prop_goals_progress(a, 'ffffffff-0000-4000-8000-000000000002');
  assert g.achieved_cents = 0 and g.pct = 0.00, 'meta S2 sem aceites';
  raise notice 'PASS: metas (realizado dentro do período da própria meta)';
end $$;
reset role;

-- ================= vendedor só enxerga os próprios números; leitor vê os totais =================
:as_s1
do $$
declare a uuid := current_setting('t.a')::uuid; k record; t date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into k from public.prop_kpis(a, t - 29, t);
  assert k.sent_count = 3 and k.accepted_count = 3 and k.declined_count = 0 and k.pipeline_count = 0, 'S1 sem filtro vê só o que é dele';
  select * into k from public.prop_kpis(a, t - 29, t, 'ffffffff-0000-4000-8000-000000000002');
  assert k.sent_count = 0 and k.accepted_count = 0, 'S1 filtrando pelo S2 não vê nada';
  assert (select count(*) from public.prop_rep_performance(a, t - 29, t)) = 1, 'ranking de vendedores só com ele mesmo';
  assert (select count(*) from public.prop_alerts(a)) = 1, 'alertas só das dele (aceita recentemente: P3)';
  assert (select count(*) from public.prop_goals_progress(a)) = 1, 'meta própria apenas';
  assert (select count(*) from public.prop_user_labels(a)) = 4, 'rótulos de todos os membros da organização';
  assert (select label from public.prop_user_labels(a) where user_id = 'ffffffff-0000-4000-8000-000000000001') = 'vendedor.um', 'rótulo pela parte local do e-mail';
  raise notice 'PASS: vendedor só enxerga os próprios números';
end $$;
reset role;
:as_v
do $$
declare a uuid := current_setting('t.a')::uuid; k record; t date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into k from public.prop_kpis(a, t - 29, t);
  assert k.sent_count = 5 and k.accepted_count = 3, 'leitor vê os totais';
  raise notice 'PASS: leitor vê os totais';
end $$;
reset role;

-- ================= organização B não enxerga A =================
:as_b
do $$
declare a uuid := current_setting('t.a')::uuid; k record; t date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into k from public.prop_kpis(a, t - 29, t);
  assert k.created_count = 0 and k.sent_count = 0 and k.pipeline_cents = 0, 'B consultando A: zero (RLS)';
  assert (select count(*) from public.prop_alerts(a)) = 0 and (select count(*) from public.prop_goals_progress(a)) = 0, 'sem alertas nem metas de A';
  assert (select count(*) from public.prop_user_labels(a)) = 0, 'sem rótulos de A';
  raise notice 'PASS: indicadores isolados entre organizações';
end $$;
reset role;

-- ================= bordas do período (org B): início 00:00:00 e fim 23:59:59.999 inclusivos, dia seguinte excluído =================
:as_b
do $$
declare b uuid := current_setting('t.b')::uuid; c uuid;
begin
  insert into public.clients (organization_id, name) values (b, 'Cliente B') returning id into c;
  perform set_config('t.cb', c::text, true);
end $$;
reset role;
do $$
declare bo uuid := 'ffffffff-0000-4000-8000-00000000000b'; c uuid := current_setting('t.cb')::uuid; p uuid;
begin
  p := test.mk(bo, c, 'B-antes',  1000, 'service', 30, 29); perform test.decide(p, 'accepted', test.d(19, '23:59:59.999'));   -- T-19 23:59:59.999: fora
  p := test.mk(bo, c, 'B-inicio', 2000, 'service', 30, 29); perform test.decide(p, 'accepted', test.d(18, '00:00:00'));       -- T-18 00:00:00: dentro
  p := test.mk(bo, c, 'B-fim',    4000, 'service', 30, 29); perform test.decide(p, 'accepted', test.d(18, '23:59:59.999'));   -- T-18 23:59:59.999: dentro
  p := test.mk(bo, c, 'B-depois', 8000, 'service', 30, 29); perform test.decide(p, 'accepted', test.d(17, '00:00:00'));       -- T-17 00:00:00: fora
  p := test.mk(bo, c, 'B-aberta', 16000, 'service', 4, 3, 5);                                                                  -- enviada e válida: entra no pipeline
  p := test.mk(bo, c, 'B-vencida', 32000, 'service', 4, 3, 5);                                                                 -- enviada, mas a validade já passou (ainda não gravada como expirada)
  perform set_config('session_replication_role', 'replica', true);
  update public.proposal_revisions set issue_date = test.d(10)::date, valid_until = test.d(1)::date where id = (select published_revision_id from public.proposals where id = p);
  perform set_config('session_replication_role', 'origin', true);
end $$;
:as_b
do $$
declare b uuid := current_setting('t.b')::uuid; k record; t date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into k from public.prop_kpis(b, t - 18, t - 18);
  assert k.accepted_count = 2 and k.accepted_cents = 6000, 'um único dia: entra 00:00:00 e 23:59:59.999; saem T-19 23:59:59.999 e T-17 00:00:00';
  select * into k from public.prop_kpis(b, t - 19, t - 17);
  assert k.accepted_count = 4 and k.accepted_cents = 15000, 'três dias: todos entram';
  assert k.pipeline_cents = 16000 and k.pipeline_count = 1, 'em negociação ignora proposta enviada cuja validade já passou';
  raise notice 'PASS: bordas do período (inclusivo no início e no fim, fuso de Brasília) e pipeline só com validade em dia';
end $$;
reset role;

rollback;
