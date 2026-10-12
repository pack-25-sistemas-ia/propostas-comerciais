-- Acesso público por token: visualizar, registrar visualização, aceitar, recusar, revogar, expirar, substituir.
-- O visitante (anon) só conhece o hash; nunca enxerga tabelas.

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@pub.invalid'),
  ('ffffffff-0000-4000-8000-000000000001', 's1@pub.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('Público A', 'publico-a');
  insert into public.organization_members (organization_id, user_id, role) values (a, 'ffffffff-0000-4000-8000-000000000001', 'member');
  insert into public.clients (organization_id, name) values (a, 'Cliente Público');
  perform set_config('t.org', a::text, true);
end $$;
reset role;

-- Três propostas publicadas: P (aceitar), Q (recusar) e R (revogar/expirar/substituir).
:as_s1
do $$
declare
  c uuid := (select id from public.clients where name = 'Cliente Público'); p uuid; r uuid; n int;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  names text[] := array['p', 'q', 'r'];
begin
  for n in 1..3 loop
    p := public.prop_create_proposal(c, 'Proposta ' || names[n]);
    r := (select current_revision_id from public.proposals where id = p);
    perform public.prop_save_draft(r, jsonb_build_object('valid_until', today + 20, 'items', jsonb_build_array(
      jsonb_build_object('item_type', 'service', 'name', 'Serviço', 'quantity', '1', 'unit_price_cents', 100000 * n))));
    perform public.prop_publish_revision(r);
    perform set_config('t.' || names[n], p::text, true);
    perform set_config('t.r' || names[n], r::text, true);
    perform public.prop_create_share_link(p, encode(sha256(convert_to('token-' || names[n], 'utf8')), 'hex'), now() + interval '30 days');
  end loop;
  assert test.throws(format($q$select public.prop_create_share_link(%L, repeat('g', 64), now() + interval '1 day')$q$, current_setting('t.p')::uuid)), 'hash inválido recusado';
  assert test.throws(format($q$select public.prop_create_share_link(%L, repeat('a', 64), now() - interval '1 day')$q$, current_setting('t.p')::uuid)), 'link já vencido recusado';
  assert test.throws(format($q$select public.prop_create_share_link(%L, repeat('a', 64), now() + interval '500 days')$q$, current_setting('t.p')::uuid)), 'validade do link limitada';
  assert test.throws(format($q$select public.prop_create_share_link(%L, encode(sha256(convert_to('token-p', 'utf8')), 'hex'), now() + interval '1 day')$q$, current_setting('t.p')::uuid)), 'hash repetido recusado';
  raise notice 'PASS: links criados (hash apenas) e validações de criação';
end $$;
reset role;

-- rascunho não pode ser compartilhado
:as_s1
do $$
declare c uuid := (select id from public.clients where name = 'Cliente Público'); d uuid;
begin
  d := public.prop_create_proposal(c, 'Rascunho');
  assert test.throws(format($q$select public.prop_create_share_link(%L, repeat('b', 64), now() + interval '1 day')$q$, d)), 'rascunho não gera link';
  raise notice 'PASS: só proposta enviada gera link';
end $$;
reset role;

-- ================= visitante: visualizar =================
:as_anon
do $$
declare h text := encode(sha256(convert_to('token-p', 'utf8')), 'hex'); v jsonb;
begin
  v := public.prop_public_view(h, false);   -- visita automática (prévia/robô): não conta como visualização
  assert v ->> 'state' = 'open' and v -> 'snapshot' -> 'pricing' ->> 'total_cents' = '100000', 'abre e traz o snapshot';
  assert v -> 'snapshot' -> 'client' ->> 'name' = 'Cliente Público', 'com o cliente';
  assert v ? 'decision' and v -> 'decision' = 'null'::jsonb, 'sem decisão ainda';
  raise notice 'PASS: visitante abre a proposta pelo token';
end $$;
reset role;
do $$
begin
  assert (select status from public.proposals where id = current_setting('t.p')::uuid) = 'sent', 'visita automática não muda para visualizada';
  assert (select count(*) from public.proposal_events where proposal_id = current_setting('t.p')::uuid and event_type = 'viewed') = 0, 'nem registra evento';
  raise notice 'PASS: visita automática não conta como visualização';
end $$;

:as_anon
do $$
declare h text := encode(sha256(convert_to('token-p', 'utf8')), 'hex');
begin
  perform public.prop_public_view(h, true);
  perform public.prop_public_view(h, true);
  perform public.prop_public_view(h, true);
end $$;
reset role;
do $$
begin
  assert (select status from public.proposals where id = current_setting('t.p')::uuid) = 'viewed', 'visita humana muda para visualizada';
  assert (select count(*) from public.proposal_events where proposal_id = current_setting('t.p')::uuid and event_type = 'viewed') = 1, 'visitas repetidas em 10 minutos geram um evento';
  raise notice 'PASS: visualização registrada uma vez e status "visualizada" (não é aceite)';
end $$;

-- ================= sem enumeração: todo link inválido responde igual =================
:as_anon
do $$
declare u jsonb := '{"state":"unavailable"}'::jsonb;
begin
  assert public.prop_public_view(repeat('0', 64), true) = u, 'link inexistente';
  assert public.prop_public_view('curto', true) = u, 'hash malformado';
  assert public.prop_public_view(null, true) = u, 'hash nulo';
  assert public.prop_public_view('token-p', true) = u, 'token cru (não é o hash) não abre';
  assert public.prop_public_decide(repeat('0', 64), 'accepted', 'Fulano', 'f@x.invalid') = '{"ok": false, "error": "unavailable"}'::jsonb, 'decidir em link inexistente';
  raise notice 'PASS: respostas idênticas para links inválidos (sem enumeração)';
end $$;
reset role;

-- ================= aceite =================
:as_anon
do $$
declare h text := encode(sha256(convert_to('token-p', 'utf8')), 'hex');
begin
  assert public.prop_public_decide(h, 'accepted', 'F', 'f@x.invalid') ->> 'error' = 'invalid', 'nome curto';
  assert public.prop_public_decide(h, 'accepted', 'Fulano de Tal', 'sem-arroba') ->> 'error' = 'invalid', 'e-mail inválido';
  assert public.prop_public_decide(h, 'maybe', 'Fulano de Tal', 'f@x.invalid') ->> 'error' = 'invalid', 'decisão inválida';
  assert public.prop_public_decide(h, 'accepted', 'Fulano de Tal', 'f@x.invalid', repeat('x', 1001)) ->> 'error' = 'invalid', 'comentário longo';
  assert (public.prop_public_decide(h, 'accepted', '  Fulano de Tal ', ' Fulano@Empresa.INVALID ', 'De acordo.') ->> 'ok')::boolean, 'aceita';
  assert public.prop_public_decide(h, 'accepted', 'Fulano de Tal', 'f@x.invalid') ->> 'error' = 'already_decided', 'não aceita duas vezes';
  assert public.prop_public_decide(h, 'declined', 'Fulano de Tal', 'f@x.invalid') ->> 'error' = 'already_decided', 'não recusa depois de aceitar';
  assert public.prop_public_view(h, true) ->> 'state' = 'decided' and public.prop_public_view(h, true) -> 'decision' ->> 'decision' = 'accepted', 'página mostra a decisão';
  raise notice 'PASS: aceite — validações, dupla decisão barrada, página mostra a decisão';
end $$;
reset role;
do $$
declare p uuid := current_setting('t.p')::uuid;
begin
  assert (select status from public.proposals where id = p) = 'accepted', 'proposta aceita';
  assert (select client_name || '|' || client_email || '|' || comment from public.proposal_decisions where proposal_id = p) = 'Fulano de Tal|fulano@empresa.invalid|De acordo.', 'dados normalizados e gravados';
  assert (select revision_id from public.proposal_decisions where proposal_id = p) = current_setting('t.rp')::uuid, 'decisão ligada à revisão publicada';
  assert (select count(*) from public.proposal_decisions where proposal_id = p) = 1, 'uma única decisão';
  assert (select count(*) from public.proposal_events where proposal_id = p and event_type = 'accepted') = 1, 'evento de aceite';
  assert test.throws(format($q$insert into public.proposal_decisions (organization_id, proposal_id, revision_id, decision, client_name, client_email) values (%L, %L, %L, 'declined', 'Outro', 'o@x.invalid')$q$, current_setting('t.org')::uuid, p, current_setting('t.rp')::uuid)), 'a restrição única impede segunda decisão da revisão';
  raise notice 'PASS: aceite persistido de forma auditável';
end $$;

-- ================= recusa =================
:as_anon
do $$
declare h text := encode(sha256(convert_to('token-q', 'utf8')), 'hex');
begin
  assert (public.prop_public_decide(h, 'declined', 'Maria Souza', 'maria@x.invalid', 'Fora do orçamento.') ->> 'ok')::boolean, 'recusa (motivo opcional)';
  assert public.prop_public_decide(h, 'accepted', 'Maria Souza', 'maria@x.invalid') ->> 'error' = 'already_decided', 'não aceita depois de recusar';
end $$;
reset role;
do $$
begin
  assert (select status from public.proposals where id = current_setting('t.q')::uuid) = 'declined', 'proposta recusada';
  assert (select count(*) from public.proposal_events where proposal_id = current_setting('t.q')::uuid and event_type = 'declined') = 1, 'evento de recusa';
  raise notice 'PASS: recusa com motivo';
end $$;

-- ================= revogar, expirar, substituir, cancelar =================
:as_s1
do $$
declare p uuid := current_setting('t.r')::uuid; l uuid;
begin
  l := (select id from public.proposal_share_links where proposal_id = p);
  perform public.prop_revoke_share_link(l);
  assert (select revoked_at from public.proposal_share_links where id = l) is not null, 'link revogado';
  assert (select count(*) from public.proposal_events where proposal_id = p and event_type = 'link_revoked') = 1, 'revogação registrada';
  perform public.prop_revoke_share_link(l);
  assert (select count(*) from public.proposal_events where proposal_id = p and event_type = 'link_revoked') = 1, 'revogar de novo não duplica evento';
end $$;
reset role;
:as_anon
do $$
declare h text := encode(sha256(convert_to('token-r', 'utf8')), 'hex');
begin
  assert public.prop_public_view(h, true) = '{"state":"unavailable"}'::jsonb, 'link revogado não abre';
  assert public.prop_public_decide(h, 'accepted', 'Fulano de Tal', 'f@x.invalid') ->> 'error' = 'unavailable', 'link revogado não decide';
  raise notice 'PASS: link revogado';
end $$;
reset role;

-- novo link; revisão substituída
:as_s1
do $$
declare p uuid := current_setting('t.r')::uuid; r2 uuid;
begin
  perform public.prop_create_share_link(p, encode(sha256(convert_to('token-r2', 'utf8')), 'hex'), now() + interval '30 days');
  perform public.prop_create_share_link(p, encode(sha256(convert_to('token-r3', 'utf8')), 'hex'), now() + interval '1 hour');
  r2 := public.prop_create_revision(p);
  perform public.prop_publish_revision(r2);
  perform set_config('t.r2', r2::text, true);
  assert (select count(*) from public.proposal_share_links where proposal_id = p and revoked_at is null) = 0, 'publicar nova revisão revoga os links da anterior';
  perform public.prop_create_share_link(p, encode(sha256(convert_to('token-r-v2', 'utf8')), 'hex'), now() + interval '30 days');
end $$;
reset role;
:as_anon
do $$
begin
  assert public.prop_public_view(encode(sha256(convert_to('token-r2', 'utf8')), 'hex'), true) = '{"state":"unavailable"}'::jsonb, 'link da versão antiga fechado';
  assert public.prop_public_view(encode(sha256(convert_to('token-r-v2', 'utf8')), 'hex'), true) ->> 'state' = 'open', 'link da versão nova abre';
  raise notice 'PASS: nova revisão fecha os links da anterior';
end $$;
reset role;

-- defesa extra: mesmo que um link antigo seja reativado, a decisão sobre revisão substituída é recusada
update public.proposal_share_links set revoked_at = null where token_hash = encode(sha256(convert_to('token-r2', 'utf8')), 'hex');
:as_anon
do $$
declare h text := encode(sha256(convert_to('token-r2', 'utf8')), 'hex');
begin
  assert public.prop_public_view(h, true) ->> 'state' = 'superseded', 'versão substituída é sinalizada';
  assert public.prop_public_view(h, true) -> 'snapshot' = 'null'::jsonb, 'sem conteúdo da versão substituída';
  assert public.prop_public_decide(h, 'accepted', 'Fulano de Tal', 'f@x.invalid') ->> 'error' = 'superseded', 'não decide sobre versão substituída';
  raise notice 'PASS: decisão sobre revisão substituída recusada';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.proposal_decisions where proposal_id = current_setting('t.r')::uuid) = 0, 'nenhuma decisão gravada';
end $$;

-- link vencido
update public.proposal_share_links set expires_at = now() - interval '1 second' where token_hash = encode(sha256(convert_to('token-r-v2', 'utf8')), 'hex');
:as_anon
do $$
begin
  assert public.prop_public_view(encode(sha256(convert_to('token-r-v2', 'utf8')), 'hex'), true) = '{"state":"unavailable"}'::jsonb, 'link com prazo vencido não abre';
  raise notice 'PASS: link vencido';
end $$;
reset role;

-- proposta expirada por validade: abre para leitura, mas não aceita
:as_s1
do $$
declare c uuid := (select id from public.clients where name = 'Cliente Público'); p uuid; r uuid; today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  p := public.prop_create_proposal(c, 'Validade curta');
  r := (select current_revision_id from public.proposals where id = p);
  perform public.prop_save_draft(r, jsonb_build_object('valid_until', today, 'items', jsonb_build_array(
    jsonb_build_object('item_type', 'service', 'name', 'X', 'quantity', '1', 'unit_price_cents', 1000))));
  perform public.prop_publish_revision(r);
  perform public.prop_create_share_link(p, encode(sha256(convert_to('token-e', 'utf8')), 'hex'), now() + interval '30 days');
  perform set_config('t.e', p::text, true); perform set_config('t.re', r::text, true);
end $$;
reset role;
set session_replication_role = replica;
update public.proposal_revisions set issue_date = issue_date - 5, valid_until = valid_until - 2 where id = current_setting('t.re')::uuid;
set session_replication_role = origin;
:as_anon
do $$
declare h text := encode(sha256(convert_to('token-e', 'utf8')), 'hex');
begin
  assert public.prop_public_decide(h, 'accepted', 'Fulano de Tal', 'f@x.invalid') ->> 'error' = 'expired', 'proposta vencida não é aceita';
  assert public.prop_public_view(h, true) ->> 'state' = 'expired' and public.prop_public_view(h, true) -> 'snapshot' <> 'null'::jsonb, 'vencida abre para leitura, com aviso';
  raise notice 'PASS: proposta vencida: leitura sim, aceite não';
end $$;
reset role;
do $$
begin
  assert (select status from public.proposals where id = current_setting('t.e')::uuid) = 'expired', 'expiração gravada pelo acesso público';
  assert (select count(*) from public.proposal_decisions where proposal_id = current_setting('t.e')::uuid) = 0, 'sem decisão';
end $$;

-- cancelada: link revogado -> indisponível
:as_s1
do $$
declare c uuid := (select id from public.clients where name = 'Cliente Público'); p uuid; r uuid; today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  p := public.prop_create_proposal(c, 'Será cancelada');
  r := (select current_revision_id from public.proposals where id = p);
  perform public.prop_save_draft(r, jsonb_build_object('valid_until', today + 9, 'items', jsonb_build_array(
    jsonb_build_object('item_type', 'service', 'name', 'X', 'quantity', '1', 'unit_price_cents', 1000))));
  perform public.prop_publish_revision(r);
  perform public.prop_create_share_link(p, encode(sha256(convert_to('token-c', 'utf8')), 'hex'), now() + interval '30 days');
  perform public.prop_cancel(p, 'Teste');
end $$;
reset role;
:as_anon
do $$
declare h text := encode(sha256(convert_to('token-c', 'utf8')), 'hex');
begin
  assert public.prop_public_view(h, true) = '{"state":"unavailable"}'::jsonb, 'cancelada fecha o link';
  assert public.prop_public_decide(h, 'accepted', 'Fulano de Tal', 'f@x.invalid') ->> 'error' = 'unavailable', 'cancelada não é aceita';
  raise notice 'PASS: proposta cancelada não abre nem aceita';
end $$;
reset role;

-- o visitante nunca recebe dados internos
:as_anon
do $$
declare v jsonb := public.prop_public_view(encode(sha256(convert_to('token-p', 'utf8')), 'hex'), false); s text;
begin
  s := v::text;
  assert s !~ 'owner_id' and s !~ 'organization_id' and s !~ 'token_hash' and s !~ 'created_by', 'resposta pública sem identificadores internos';
  assert (select count(*) from jsonb_object_keys(v)) = 5, 'chaves da resposta: state, number, valid_until, snapshot, decision';
  raise notice 'PASS: resposta pública não vaza dados internos';
end $$;
reset role;

rollback;
