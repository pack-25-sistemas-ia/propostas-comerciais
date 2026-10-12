-- Propostas: isolamento entre organizações e matriz de papéis (RLS).
-- Org A: A (owner), M (manager), S1 e S2 (member/vendedores), V (viewer). Org B: B (owner).

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_a1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal1"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000c","aal":"aal1"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'
\set as_s2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000002","aal":"aal1"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000003","aal":"aal1"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@prop.invalid'),
  ('ffffffff-0000-4000-8000-00000000000b', 'b@prop.invalid'),
  ('ffffffff-0000-4000-8000-00000000000c', 'm@prop.invalid'),
  ('ffffffff-0000-4000-8000-000000000001', 's1@prop.invalid'),
  ('ffffffff-0000-4000-8000-000000000002', 's2@prop.invalid'),
  ('ffffffff-0000-4000-8000-000000000003', 'v@prop.invalid');

:as_a
do $$ begin perform public.create_organization('Prop A', 'prop-a'); end $$;
reset role;
:as_b
do $$ begin perform public.create_organization('Prop B', 'prop-b'); end $$;
reset role;
insert into test.org select 'xa', id from public.organizations where slug = 'prop-a';
insert into test.org select 'xb', id from public.organizations where slug = 'prop-b';

:as_a
do $$
declare a uuid := (select id from test.org where name = 'xa');
begin
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-00000000000c', 'manager'),
    (a, 'ffffffff-0000-4000-8000-000000000001', 'member'),
    (a, 'ffffffff-0000-4000-8000-000000000002', 'member'),
    (a, 'ffffffff-0000-4000-8000-000000000003', 'viewer');
end $$;
reset role;

-- ================= padrões criados com a organização =================
do $$
declare a uuid := (select id from test.org where name = 'xa');
begin
  assert (select count(*) from public.proposal_settings where organization_id = a) = 1, 'configuração criada';
  assert (select count(*) from public.proposal_templates where organization_id = a) = 3, 'três modelos padrão';
  assert (select count(*) from public.proposal_templates where organization_id = a and is_default) = 1, 'um modelo padrão';
  assert (select array_agg(base order by base) from public.proposal_templates where organization_id = a) = array['agency', 'corporate', 'technical'], 'corporativo, agência e técnico';
  assert (select default_validity_days from public.proposal_settings where organization_id = a) = 30, 'validade padrão 30 dias';
  assert (select max_discount_member_pct from public.proposal_settings where organization_id = a) = 10, 'limite do vendedor 10%';
  raise notice 'PASS: padrões de propostas criados junto com a organização';
end $$;

-- ================= clientes e catálogo =================
:as_s1
do $$
declare a uuid := (select id from test.org where name = 'xa');
begin
  assert not test.throws(format($q$insert into public.clients (organization_id, name, email, document_number) values (%L, 'Cliente S1', 'Cli@Ex.invalid', '12.345.678/0001-95')$q$, a)), 'vendedor cadastra cliente';
  assert (select email from public.clients where name = 'Cliente S1') = 'cli@ex.invalid', 'e-mail normalizado';
  assert (select document_number from public.clients where name = 'Cliente S1') = '12345678000195', 'documento só com dígitos';
  assert test.throws(format($q$insert into public.clients (organization_id, name, document_number) values (%L, 'Duplicado', '12345678000195')$q$, a)), 'documento duplicado barrado';
  assert test.throws(format($q$insert into public.catalog_items (organization_id, name) values (%L, 'Item do vendedor')$q$, a)), 'vendedor não cadastra catálogo';
  assert test.throws($q$delete from public.clients$q$), 'ninguém exclui cliente (arquiva-se)';
  assert test.affected($q$update public.clients set archived_at = now() where name = 'Cliente S1'$q$) = 1, 'vendedor arquiva cliente';
  assert test.affected($q$update public.clients set archived_at = null where name = 'Cliente S1'$q$) = 1, 'e restaura';
  raise notice 'PASS: vendedor — clientes sim, catálogo não, sem exclusão';
end $$;
reset role;

:as_m
do $$
declare a uuid := (select id from test.org where name = 'xa');
begin
  assert not test.throws(format($q$insert into public.catalog_items (organization_id, type, name, sku, unit, default_price_cents) values (%L, 'service', 'Consultoria', 'CONS-1', 'h', 15000)$q$, a)), 'gestor cadastra catálogo';
  assert test.throws(format($q$insert into public.catalog_items (organization_id, name, sku) values (%L, 'Outro', 'cons-1')$q$, a)), 'SKU único por organização (sem diferenciar maiúsculas)';
  assert test.throws(format($q$insert into public.catalog_items (organization_id, name, default_price_cents) values (%L, 'Preço negativo', -1)$q$, a)), 'preço negativo barrado';
  assert test.affected($q$update public.catalog_items set active = false where sku = 'CONS-1'$q$) = 1, 'gestor desativa item';
  assert test.affected($q$update public.catalog_items set active = true where sku = 'CONS-1'$q$) = 1, 'e reativa';
  assert test.affected($q$update public.proposal_settings set max_discount_member_pct = 90$q$) = 0, 'gestor não altera configurações (a RLS filtra a linha)';
  raise notice 'PASS: gestor — catálogo sim, configurações não';
end $$;
reset role;

:as_v
do $$
declare a uuid := (select id from test.org where name = 'xa');
begin
  assert (select count(*) from public.clients) = 1, 'leitor vê clientes';
  assert (select count(*) from public.catalog_items) = 1, 'leitor vê catálogo';
  assert test.throws(format($q$insert into public.clients (organization_id, name) values (%L, 'Leitor')$q$, a)), 'leitor não cadastra cliente';
  assert test.throws(format($q$insert into public.catalog_items (organization_id, name) values (%L, 'Leitor')$q$, a)), 'leitor não cadastra catálogo';
  raise notice 'PASS: leitor só lê';
end $$;
reset role;

-- ================= propostas: criação só pela função =================
:as_s1
select set_config('t.c1', (select id::text from public.clients where name = 'Cliente S1'), true);
do $$
declare p uuid; a uuid := (select id from test.org where name = 'xa'); c uuid := current_setting('t.c1')::uuid;
begin
  assert test.throws(format($q$insert into public.proposals (organization_id, client_id, owner_id, proposal_number, title) values (%L, %L, auth.uid(), 'X', 'Direta')$q$, a, c)), 'insert direto em proposals barrado';
  p := public.prop_create_proposal(c, 'Proposta do S1');
  assert (select proposal_number from public.proposals where id = p) = '00001', 'primeiro número da organização A';
  assert (select status from public.proposals where id = p) = 'draft', 'nasce como rascunho';
  assert (select owner_id from public.proposals where id = p) = auth.uid(), 'responsável é quem criou';
  assert (select count(*) from public.proposal_revisions where proposal_id = p and version_number = 1 and published_at is null) = 1, 'revisão 1 em rascunho';
  assert (select jsonb_array_length(content_json -> 'sections') from public.proposal_revisions where proposal_id = p) = 7, 'seções do modelo padrão';
  assert (select valid_until - issue_date from public.proposal_revisions where proposal_id = p) = 30, 'validade padrão de 30 dias';
  assert test.throws(format($q$select public.prop_create_proposal(%L, 'Para o S2', null, 'ffffffff-0000-4000-8000-000000000002')$q$, c)), 'vendedor não cria em nome de outro';
  assert test.throws(format($q$select public.prop_create_proposal(%L, 'x')$q$, c)), 'título curto barrado';
  perform set_config('t.p1', p::text, true);
  perform set_config('t.r1', (select current_revision_id::text from public.proposals where id = p), true);
  raise notice 'PASS: criação de proposta pela função (número, rascunho, revisão 1, seções)';
end $$;
reset role;

:as_m
do $$
declare c uuid := current_setting('t.c1')::uuid; p2 uuid;
begin
  p2 := public.prop_create_proposal(c, 'Proposta do gestor para S2', null, 'ffffffff-0000-4000-8000-000000000002');
  assert (select proposal_number from public.proposals where id = p2) = '00002', 'numeração sequencial';
  assert (select count(*) from public.proposals) = 2, 'gestor vê todas';
  perform set_config('t.p2', p2::text, true);
  raise notice 'PASS: gestor cria para outro responsável; vê tudo';
end $$;
reset role;

:as_s1
do $$
begin
  assert (select count(*) from public.proposals) = 1, 'vendedor S1 só vê a dele';
  assert (select count(*) from public.proposal_revisions) = 1, 'e só as revisões dela';
  assert test.throws($q$update public.proposals set status = 'accepted'$q$), 'status não é gravável direto';
  assert test.throws($q$update public.proposals set proposal_number = '99999'$q$), 'número não é gravável';
  assert test.throws($q$update public.proposals set owner_id = 'ffffffff-0000-4000-8000-000000000002'$q$), 'vendedor não repassa a proposta';
  assert test.throws($q$delete from public.proposals$q$), 'ninguém exclui proposta';
  assert test.throws($q$delete from public.proposal_events$q$), 'linha do tempo é só de inserção (delete)';
  assert test.throws($q$update public.proposal_events set event_type = 'accepted'$q$), 'linha do tempo é só de inserção (update)';
  assert test.throws($q$update public.proposal_revisions set total_cents = 1$q$), 'revisão só muda pela função';
  assert test.throws($q$insert into public.proposal_decisions (organization_id, proposal_id, revision_id, decision, client_name, client_email) select organization_id, id, current_revision_id, 'accepted', 'Fulano', 'f@x.invalid' from public.proposals$q$), 'decisão não é gravável por usuário';
  raise notice 'PASS: vendedor — só o que é dele, sem escrita direta em status/número/histórico';
end $$;
reset role;

:as_s2
do $$
declare p2 uuid := current_setting('t.p2')::uuid; p1 uuid := current_setting('t.p1')::uuid;
begin
  assert (select count(*) from public.proposals) = 1, 'S2 vê só a atribuída a ele';
  assert (select count(*) from public.proposals where id = p1) = 0, 'S2 não vê a do S1';
  assert test.throws(format($q$select public.prop_save_draft((select current_revision_id from public.proposals where id = %L), '{}'::jsonb)$q$, p1)), 'S2 não edita a do S1';
  assert test.throws(format($q$select public.prop_cancel(%L)$q$, p1)), 'S2 não cancela a do S1';
  assert test.throws(format($q$select public.prop_duplicate(%L)$q$, p1)), 'S2 não duplica a do S1';
  assert not test.throws(format($q$select public.prop_duplicate(%L)$q$, p2)), 'S2 duplica a dele';
  raise notice 'PASS: vendedor não age sobre proposta de outro vendedor';
end $$;
reset role;

:as_v
do $$
declare c uuid := current_setting('t.c1')::uuid;
begin
  assert (select count(*) from public.proposals) = 3, 'leitor vê todas';
  assert test.throws(format($q$select public.prop_create_proposal(%L, 'Do leitor')$q$, c)), 'leitor não cria';
  assert test.throws(format($q$select public.prop_cancel(%L)$q$, current_setting('t.p1')::uuid)), 'leitor não cancela';
  assert test.throws(format($q$select public.prop_publish_revision((select current_revision_id from public.proposals where id = %L))$q$, current_setting('t.p1')::uuid)), 'leitor não publica';
  raise notice 'PASS: leitor lê e não escreve';
end $$;
reset role;

-- ================= isolamento entre organizações =================
:as_b
do $$
declare p1 uuid := current_setting('t.p1')::uuid; r1 uuid := current_setting('t.r1')::uuid; c uuid := current_setting('t.c1')::uuid;
begin
  assert (select count(*) from public.proposals) = 0, 'B não vê propostas de A';
  assert (select count(*) from public.clients) = 0, 'B não vê clientes de A';
  assert (select count(*) from public.catalog_items) = 0, 'B não vê catálogo de A';
  assert (select count(*) from public.proposal_templates where organization_id = (select id from test.org where name = 'xa')) = 0, 'B não vê modelos de A';
  assert (select count(*) from public.proposal_revisions) = 0 and (select count(*) from public.proposal_items) = 0 and (select count(*) from public.proposal_events) = 0, 'B não vê filhas de A';
  assert test.throws(format($q$select public.prop_create_proposal(%L, 'Invasão')$q$, c)), 'B não cria proposta com cliente de A';
  assert test.throws(format($q$select public.prop_save_draft(%L, '{"title":"Invasão"}')$q$, r1)), 'B não edita revisão de A';
  assert test.throws(format($q$select public.prop_publish_revision(%L)$q$, r1)), 'B não publica revisão de A';
  assert test.throws(format($q$select public.prop_cancel(%L)$q$, p1)), 'B não cancela proposta de A';
  assert test.throws(format($q$select public.prop_duplicate(%L)$q$, p1)), 'B não duplica proposta de A';
  assert test.throws(format($q$select public.prop_create_share_link(%L, repeat('a', 64), now() + interval '1 day')$q$, p1)), 'B não cria link para A';
  assert test.affected(format($q$update public.proposals set archived_at = now() where id = %L$q$, p1)) = 0, 'B não arquiva a de A';
  assert test.throws(format($q$select public.prop_expire_overdue(%L)$q$, (select id from test.org where name = 'xa'))), 'B não roda expiração em A';
  raise notice 'PASS: organização B isolada de A (leitura e funções)';
end $$;
reset role;

:as_b
do $$
declare b uuid := (select id from test.org where name = 'xb'); c uuid; p uuid;
begin
  insert into public.clients (organization_id, name) values (b, 'Cliente B') returning id into c;
  p := public.prop_create_proposal(c, 'Proposta B');
  assert (select proposal_number from public.proposals where id = p) = '00001', 'numeração própria da organização B';
  assert (select count(*) from public.proposals) = 1, 'B vê só a própria';
  raise notice 'PASS: numeração independente por organização';
end $$;
reset role;

-- ================= MFA no banco para owner/admin =================
:as_a1
do $$
declare c uuid := current_setting('t.c1')::uuid;
begin
  assert test.throws(format($q$select public.prop_create_proposal(%L, 'Sem MFA')$q$, c)), 'owner sem AAL2 não cria proposta';
  assert test.throws(format($q$insert into public.catalog_items (organization_id, name) values (%L, 'Sem MFA')$q$, (select id from test.org where name = 'xa'))), 'owner sem AAL2 não escreve no catálogo';
  raise notice 'PASS: owner/admin sem AAL2 barrados também nas funções de propostas';
end $$;
reset role;

:as_a
do $$
declare c uuid := current_setting('t.c1')::uuid;
begin
  assert not test.throws(format($q$select public.prop_create_proposal(%L, 'Com MFA')$q$, c)), 'owner com AAL2 cria';
  assert not test.throws($q$update public.proposal_settings set number_prefix = 'PROP-'$q$), 'owner altera configurações';
  assert test.throws($q$update public.proposal_settings set last_number = 0$q$), 'contador de numeração não é gravável';
  assert test.throws($q$update public.proposal_settings set logo_data_url = 'data:text/html;base64,PHNjcmlwdD4='$q$), 'logotipo só PNG/JPEG';
  assert test.throws($q$update public.proposal_settings set primary_color = 'red'$q$), 'cor precisa ser #RRGGBB';
  assert not test.throws($q$update public.proposal_settings set logo_data_url = 'data:image/png;base64,iVBORw0KGgo='$q$), 'logotipo PNG aceito';
  assert test.affected($q$update public.proposal_templates set is_default = true where base = 'agency'$q$) = 1, 'troca o modelo padrão';
  assert (select base from public.proposal_templates where is_default) = 'agency', 'só um padrão';
  assert (select count(*) from public.proposal_templates where is_default) = 1, 'apenas um padrão';
  assert test.throws($q$update public.proposal_templates set is_default = false where base = 'agency'$q$), 'não fica sem padrão';
  raise notice 'PASS: configurações e modelos (owner com MFA)';
end $$;
reset role;

-- ================= anon =================
:as_anon
do $$
begin
  assert test.throws('select * from public.proposals'), 'anon não lê propostas';
  assert test.throws('select * from public.proposal_share_links'), 'anon não lê links';
  assert test.throws('select * from public.proposal_decisions'), 'anon não lê decisões';
  assert test.throws('select * from public.clients'), 'anon não lê clientes';
  assert test.throws($q$select public.prop_compute('[]')$q$), 'anon não usa o motor de cálculo';
  assert test.throws($q$select public.prop_create_proposal(gen_random_uuid(), 'x')$q$), 'anon não cria proposta';
  assert test.throws($q$select public.prop_publish_revision(gen_random_uuid())$q$), 'anon não publica';
  assert test.throws($q$select public.prop_expire_overdue(gen_random_uuid())$q$), 'anon não expira';
  assert test.throws($q$select public.prop_create_share_link(gen_random_uuid(), repeat('a', 64), now() + interval '1 day')$q$), 'anon não cria link';
  raise notice 'PASS: anon sem acesso às tabelas e às funções internas';
end $$;
reset role;

-- A lista de funções públicas é EXATAMENTE esta (qualquer outra seria uma porta aberta).
do $$
declare bad text;
begin
  select string_agg(p.proname, ',' order by p.proname) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not like 'uuid%' and p.proname not like 'gen_%' and p.pronamespace = n.oid
    and p.prosecdef;
  assert bad = 'prop_public_decide,prop_public_view', 'funções SECURITY DEFINER executáveis por anon: ' || coalesce(bad, '(nenhuma)');
  raise notice 'PASS: anon executa somente as duas funções públicas, marcadas PUBLIC_ENDPOINT';
end $$;

rollback;
