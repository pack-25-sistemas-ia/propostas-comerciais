-- Propostas: rascunho, cálculo persistido, publicação, imutabilidade, revisões, limites de desconto, duplicação, cancelamento, expiração.
-- Org A: A (owner), M (manager), S1 (vendedor).

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-00000000000c","aal":"aal1"}'', true); set local role authenticated;'
\set as_s1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-000000000001","aal":"aal1"}'', true); set local role authenticated;'

begin;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-00000000000a', 'a@flow.invalid'),
  ('ffffffff-0000-4000-8000-00000000000c', 'm@flow.invalid'),
  ('ffffffff-0000-4000-8000-000000000001', 's1@flow.invalid');

:as_a
do $$
declare a uuid;
begin
  a := public.create_organization('Fluxo A', 'fluxo-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'ffffffff-0000-4000-8000-00000000000c', 'manager'),
    (a, 'ffffffff-0000-4000-8000-000000000001', 'member');
  insert into public.clients (organization_id, name, legal_name, email, document_number) values (a, 'Cliente Alfa', 'Alfa Ltda', 'contato@alfa.invalid', '11222333000181');
  insert into public.clients (organization_id, name) values (a, 'Cliente Beta');
  insert into public.catalog_items (organization_id, type, name, unit, default_price_cents) values (a, 'service', 'Consultoria', 'h', 15000);
  perform set_config('t.org', a::text, true);
end $$;
reset role;

-- ================= rascunho: cálculo feito no banco =================
:as_s1
do $$
declare
  alfa uuid := (select id from public.clients where name = 'Cliente Alfa');
  p uuid; r uuid; calc jsonb; today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  p := public.prop_create_proposal(alfa, 'Proposta Alfa');
  r := (select current_revision_id from public.proposals where id = p);
  perform set_config('t.p', p::text, true); perform set_config('t.r', r::text, true);

  calc := public.prop_save_draft(r, jsonb_build_object(
    'title', 'Proposta Alfa — Consultoria', 'valid_until', today + 15, 'total_cents', 1, 'status', 'accepted',
    'discount', jsonb_build_object('kind', 'percent', 'value', '5'),
    'charges', jsonb_build_array(jsonb_build_object('label', 'Frete', 'kind', 'fixed', 'value', '1000')),
    'items', jsonb_build_array(
      jsonb_build_object('item_type', 'service', 'name', 'Consultoria', 'unit', 'h', 'quantity', '10', 'unit_price_cents', 15000, 'discount_kind', 'percent', 'discount_value', '4'),
      jsonb_build_object('item_type', 'product', 'name', 'Licença', 'unit', 'un', 'quantity', '2', 'unit_price_cents', 49900))));
  -- à mão: itens 150000-6000 = 144000 e 99800; subtotal 243800; global 5% = 12190; base 231610; frete 1000; total 232610
  assert (calc ->> 'total_cents')::bigint = 232610, 'total calculado = 232610';
  assert (select total_cents from public.proposal_revisions where id = r) = 232610, 'total persistido na revisão';
  assert (select subtotal_cents from public.proposal_revisions where id = r) = 243800, 'subtotal persistido';
  assert (select discount_cents from public.proposal_revisions where id = r) = 12190, 'desconto global persistido';
  assert (select items_discount_cents from public.proposal_revisions where id = r) = 6000, 'desconto dos itens persistido';
  assert (select additional_charges_cents from public.proposal_revisions where id = r) = 1000, 'encargos persistidos';
  assert (select array_agg(total_cents order by position) from public.proposal_items where revision_id = r) = array[144000, 99800]::bigint[], 'totais dos itens persistidos';
  assert (select status from public.proposals where id = p) = 'draft', 'status não vem do payload';
  assert (select title from public.proposals where id = p) = 'Proposta Alfa — Consultoria', 'título atualizado';

  -- regravar substitui os itens (não duplica) e valor inválido não deixa rastro
  assert test.throws(format($q$select public.prop_save_draft(%L, '{"items":[{"item_type":"service","name":"Ruim","quantity":"0","unit_price_cents":1}]}')$q$, r)), 'quantidade zero recusada';
  assert (select count(*) from public.proposal_items where revision_id = r) = 2, 'recusa não apaga os itens existentes';
  assert test.throws(format($q$select public.prop_save_draft(%L, '{"valid_until":"2000-01-01"}')$q$, r)), 'validade anterior à emissão recusada';
  assert test.throws(format($q$select public.prop_save_draft(%L, '{"content_json":{"sections":"x"}}')$q$, r)), 'conteúdo inválido recusado';
  assert test.throws(format($q$select public.prop_save_draft(%L, jsonb_build_object('items', (select jsonb_agg(jsonb_build_object('item_type','service','name','x','quantity','1','unit_price_cents',1)) from generate_series(1, 201))))$q$, r)), 'mais de 200 itens recusado';
  raise notice 'PASS: rascunho — cálculo no banco, totais persistidos, payload não dita status/total, falhas sem rastro';
end $$;
reset role;

-- ================= publicar: limite de desconto por perfil, snapshot, imutabilidade =================
:as_s1
do $$
declare p uuid := current_setting('t.p')::uuid; r uuid := current_setting('t.r')::uuid;
begin
  -- desconto total (itens 6000 + global) / bruto 249800: 20% global estoura os 10% do vendedor
  perform public.prop_save_draft(r, '{"discount":{"kind":"percent","value":"20"}, "items":[
    {"item_type":"service","name":"Consultoria","unit":"h","quantity":"10","unit_price_cents":15000,"discount_kind":"percent","discount_value":"4"},
    {"item_type":"product","name":"Licença","unit":"un","quantity":"2","unit_price_cents":49900}]}'::jsonb);
  assert test.throws(format($q$select public.prop_publish_revision(%L)$q$, r)), 'vendedor acima do limite de desconto não publica';
  assert (select published_at from public.proposal_revisions where id = r) is null, 'nada foi publicado';
  perform public.prop_save_draft(r, '{"discount":{"kind":"percent","value":"5"}, "charges":[{"label":"Frete","kind":"fixed","value":"1000"}]}'::jsonb);
  raise notice 'PASS: limite de desconto do vendedor barra a publicação';
end $$;
reset role;

:as_s1
do $$
declare p uuid := current_setting('t.p')::uuid; r uuid := current_setting('t.r')::uuid; snap jsonb; res jsonb;
begin
  -- sem validade futura não publica
  perform public.prop_save_draft(r, jsonb_build_object('valid_until', null));
  assert test.throws(format($q$select public.prop_publish_revision(%L)$q$, r)), 'sem validade não publica';
  perform public.prop_save_draft(r, jsonb_build_object('valid_until', (now() at time zone 'America/Sao_Paulo')::date + 15));

  res := public.prop_publish_revision(r);
  assert (res ->> 'total_cents')::bigint = 232610 and (res ->> 'version')::int = 1, 'publicou a versão 1 com o total esperado';
  assert (select status from public.proposals where id = p) = 'sent', 'status enviada';
  assert (select first_sent_at from public.proposals where id = p) is not null, 'primeiro envio registrado';
  assert (select published_revision_id from public.proposals where id = p) = r, 'revisão publicada vigente';
  snap := (select snapshot_json from public.proposal_revisions where id = r);
  assert snap -> 'pricing' ->> 'total_cents' = '232610', 'snapshot com total';
  assert snap -> 'client' ->> 'name' = 'Cliente Alfa' and snap -> 'client' ->> 'document_number' = '11222333000181', 'snapshot com cliente';
  assert snap -> 'company' ->> 'name' = 'Fluxo A', 'snapshot com a empresa';
  assert jsonb_array_length(snap -> 'items') = 2 and snap -> 'items' -> 0 ->> 'name' = 'Consultoria' and (snap -> 'items' -> 0 ->> 'total_cents') = '144000', 'snapshot com itens e totais';
  assert snap -> 'template' ->> 'base' = 'corporate', 'snapshot com o modelo';
  assert snap -> 'proposal' ->> 'number' = '00001', 'snapshot com o número';
  assert (select array_agg(event_type order by id) from public.proposal_events where proposal_id = p) = array['created', 'published', 'sent'], 'linha do tempo: criada, publicada, enviada';
  perform set_config('t.snap1', snap::text, true);
  raise notice 'PASS: publicação — status, snapshot completo e linha do tempo';
end $$;
reset role;

-- imutabilidade (até para quem ignora o RLS: gatilhos)
do $$
declare r uuid := current_setting('t.r')::uuid;
begin
  assert test.throws(format($q$update public.proposal_revisions set total_cents = 1 where id = %L$q$, r)), 'revisão publicada não muda (total)';
  assert test.throws(format($q$update public.proposal_revisions set snapshot_json = '{}' where id = %L$q$, r)), 'revisão publicada não muda (snapshot)';
  assert test.throws(format($q$update public.proposal_items set quantity = 99 where revision_id = %L$q$, r)), 'item de revisão publicada não muda';
  assert test.throws(format($q$delete from public.proposal_items where revision_id = %L$q$, r)), 'item de revisão publicada não sai';
  assert test.throws(format($q$insert into public.proposal_items (organization_id, revision_id, name, quantity, unit_price_cents, position) values (%L, %L, 'Intruso', 1, 1, 9)$q$, current_setting('t.org')::uuid, r)), 'item novo em revisão publicada recusado';
  raise notice 'PASS: revisão publicada e seus itens são imutáveis';
end $$;

:as_s1
do $$
declare r uuid := current_setting('t.r')::uuid;
begin
  assert test.throws(format($q$select public.prop_save_draft(%L, '{"title":"Tentativa"}')$q$, r)), 'save_draft recusa revisão publicada';
  assert test.throws(format($q$select public.prop_publish_revision(%L)$q$, r)), 'não publica duas vezes';
  assert test.throws(format($q$select public.prop_save_draft((select current_revision_id from public.proposals where id = %L), jsonb_build_object('client_id', (select id from public.clients where name = 'Cliente Beta')))$q$, current_setting('t.p')::uuid)), 'cliente não troca após publicar';
  raise notice 'PASS: edição direta da publicada e troca de cliente recusadas';
end $$;
reset role;

-- catálogo e configurações mudam depois; a publicada não
:as_a
update public.catalog_items set default_price_cents = 99999, name = 'Consultoria (novo nome)' where name = 'Consultoria';
update public.proposal_settings set primary_color = '#FF0000', footer_text = 'Rodapé novo', legal_name = 'Outro Nome Ltda';
reset role;
do $$
begin
  assert (select snapshot_json from public.proposal_revisions where id = current_setting('t.r')::uuid) = current_setting('t.snap1')::jsonb,
    'snapshot idêntico depois de mudar catálogo e configurações';
  raise notice 'PASS: mudanças no catálogo/configurações não alteram a revisão publicada';
end $$;

-- ================= revisões =================
:as_s1
do $$
declare p uuid := current_setting('t.p')::uuid; r1 uuid := current_setting('t.r')::uuid; r2 uuid;
begin
  r2 := public.prop_create_revision(p);
  assert (select version_number from public.proposal_revisions where id = r2) = 2, 'versão 2';
  assert (select published_at from public.proposal_revisions where id = r2) is null, 'versão 2 em rascunho';
  assert (select count(*) from public.proposal_items where revision_id = r2) = 2, 'itens copiados';
  assert (select total_cents from public.proposal_revisions where id = r2) = 232610, 'total copiado';
  assert (select current_revision_id from public.proposals where id = p) = r2 and (select published_revision_id from public.proposals where id = p) = r1, 'vigente = v2 (rascunho); publicada = v1';
  assert test.throws(format($q$select public.prop_create_revision(%L)$q$, p)), 'não abre outra revisão enquanto há rascunho';
  perform public.prop_save_draft(r2, '{"items":[{"item_type":"service","name":"Consultoria","unit":"h","quantity":"12","unit_price_cents":15000}]}'::jsonb);
  assert (select snapshot_json from public.proposal_revisions where id = r1) = current_setting('t.snap1')::jsonb, 'v1 intacta ao editar v2';
  assert (select count(*) from public.proposal_items where revision_id = r1) = 2, 'itens da v1 intactos';
  perform public.prop_publish_revision(r2);
  assert (select published_revision_id from public.proposals where id = p) = r2, 'v2 é a publicada';
  assert (select status from public.proposals where id = p) = 'sent', 'continua enviada';
  assert (select count(*) from public.proposal_revisions where proposal_id = p and published_at is not null) = 2, 'as duas versões ficam disponíveis';
  assert (select count(*) from public.proposal_events where proposal_id = p and event_type = 'sent') = 1, 'só o primeiro envio conta como "enviada"';
  assert (select count(*) from public.proposal_events where proposal_id = p and event_type = 'published') = 2, 'duas publicações';
  assert (select total_cents from public.proposal_revisions where id = r2) = 180000 - 0 - 9000 + 1000, 'v2: 12x150 = 180000, global 5% = 9000, frete 1000 → 172000';
  raise notice 'PASS: revisões — v2 a partir da v1, v1 preservada, envio contado uma vez';
end $$;
reset role;

-- ================= duplicar e cancelar =================
:as_s1
do $$
declare p uuid := current_setting('t.p')::uuid; d uuid; beta uuid := (select id from public.clients where name = 'Cliente Beta'); c uuid;
begin
  d := public.prop_duplicate(p);
  assert (select proposal_number from public.proposals where id = d) = '00002', 'número novo';
  assert (select status from public.proposals where id = d) = 'draft' and (select owner_id from public.proposals where id = d) = auth.uid(), 'rascunho do vendedor';
  assert (select count(*) from public.proposal_items i join public.proposal_revisions r on r.id = i.revision_id where r.proposal_id = d) = 1, 'itens da última versão copiados';
  assert (select published_at from public.proposal_revisions where proposal_id = d) is null, 'cópia em rascunho';
  assert (select event_type || ':' || (metadata ->> 'duplicated_from') from public.proposal_events where proposal_id = d) = 'created:00001', 'origem registrada';
  perform public.prop_save_draft((select current_revision_id from public.proposals where id = d), jsonb_build_object('client_id', beta));
  assert (select client_id from public.proposals where id = d) = beta, 'cliente troca enquanto é rascunho';

  c := public.prop_duplicate(p, beta);
  perform public.prop_cancel(c, 'Cliente desistiu');
  assert (select status from public.proposals where id = c) = 'cancelled', 'cancelada';
  assert (select metadata ->> 'reason' from public.proposal_events where proposal_id = c and event_type = 'cancelled') = 'Cliente desistiu', 'motivo registrado';
  assert test.throws(format($q$select public.prop_publish_revision((select current_revision_id from public.proposals where id = %L))$q$, c)), 'cancelada não publica';
  assert test.throws(format($q$select public.prop_create_revision(%L)$q$, c)), 'cancelada não abre revisão';
  assert test.throws(format($q$select public.prop_cancel(%L)$q$, c)), 'não cancela duas vezes';
  -- arquivar (permitido) e depois não editar
  assert test.affected(format($q$update public.proposals set archived_at = now() where id = %L$q$, c)) = 1, 'arquiva';
  assert test.throws(format($q$select public.prop_save_draft((select current_revision_id from public.proposals where id = %L), '{"title":"Zumbi"}')$q$, c)), 'arquivada não edita';
  raise notice 'PASS: duplicar, cancelar e arquivar';
end $$;
reset role;

-- ================= máquina de estados (gatilho vale até para superusuário) =================
do $$
declare p uuid := current_setting('t.p')::uuid; d uuid := (select id from public.proposals where proposal_number = '00002');
begin
  assert test.throws(format($q$update public.proposals set status = 'accepted' where id = %L$q$, d)), 'rascunho não vira aceita';
  assert test.throws(format($q$update public.proposals set status = 'viewed' where id = %L$q$, d)), 'rascunho não vira visualizada';
  assert test.throws(format($q$update public.proposals set status = 'sent' where id = %L$q$, (select id from public.proposals where status = 'cancelled'))), 'cancelada é terminal';
  update public.proposals set status = 'accepted' where id = p;
  assert test.throws(format($q$update public.proposals set status = 'sent' where id = %L$q$, p)), 'aceita é terminal (sent)';
  assert test.throws(format($q$update public.proposals set status = 'declined' where id = %L$q$, p)), 'aceita é terminal (declined)';
  assert test.throws(format($q$update public.proposals set status = 'cancelled' where id = %L$q$, p)), 'aceita é terminal (cancelled)';
  raise notice 'PASS: transições de status inválidas barradas por gatilho';
end $$;

-- proposta aceita: sem nova revisão, sem cancelar
:as_s1
do $$
declare p uuid := current_setting('t.p')::uuid;
begin
  assert test.throws(format($q$select public.prop_create_revision(%L)$q$, p)), 'aceita não ganha revisão';
  assert test.throws(format($q$select public.prop_cancel(%L)$q$, p)), 'aceita não se cancela';
  raise notice 'PASS: proposta aceita é definitiva';
end $$;
reset role;

-- ================= limites de desconto: borda exata e gestor =================
:as_s1
do $$
declare beta uuid := (select id from public.clients where name = 'Cliente Beta'); p uuid; r uuid; v date := (now() at time zone 'America/Sao_Paulo')::date + 10;
begin
  p := public.prop_create_proposal(beta, 'Limite 10%');
  r := (select current_revision_id from public.proposals where id = p);
  perform public.prop_save_draft(r, jsonb_build_object('valid_until', v, 'items', jsonb_build_array(
    jsonb_build_object('item_type','service','name','X','quantity','1','unit_price_cents',10000,'discount_kind','fixed','discount_value','1001'))));
  assert test.throws(format($q$select public.prop_publish_revision(%L)$q$, r)), '10,01% acima do limite de 10%';
  perform public.prop_save_draft(r, jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('item_type','service','name','X','quantity','1','unit_price_cents',10000,'discount_kind','fixed','discount_value','1000'))));
  perform public.prop_publish_revision(r);  -- exatamente 10% é permitido (se falhar, a mensagem aparece)
  raise notice 'PASS: limite do vendedor na borda (10,00 por cento passa, 10,01 não)';
end $$;
reset role;

:as_m
do $$
declare beta uuid := (select id from public.clients where name = 'Cliente Beta'); p uuid; r uuid; v date := (now() at time zone 'America/Sao_Paulo')::date + 10;
begin
  p := public.prop_create_proposal(beta, 'Limite do gestor');
  r := (select current_revision_id from public.proposals where id = p);
  perform public.prop_save_draft(r, jsonb_build_object('valid_until', v, 'discount', jsonb_build_object('kind','percent','value','35'),
    'items', jsonb_build_array(jsonb_build_object('item_type','service','name','X','quantity','1','unit_price_cents',10000))));
  assert test.throws(format($q$select public.prop_publish_revision(%L)$q$, r)), 'gestor: 35% acima do limite de 30%';
  perform public.prop_save_draft(r, jsonb_build_object('discount', jsonb_build_object('kind','percent','value','25')));
  assert not test.throws(format($q$select public.prop_publish_revision(%L)$q$, r)), 'gestor: 25% permitido';
  raise notice 'PASS: limite do gestor (30 por cento)';
end $$;
reset role;

:as_a
do $$
declare beta uuid := (select id from public.clients where name = 'Cliente Beta'); p uuid; r uuid; v date := (now() at time zone 'America/Sao_Paulo')::date + 10;
begin
  p := public.prop_create_proposal(beta, 'Sem limite para admin');
  r := (select current_revision_id from public.proposals where id = p);
  perform public.prop_save_draft(r, jsonb_build_object('valid_until', v, 'discount', jsonb_build_object('kind','percent','value','90'),
    'items', jsonb_build_array(jsonb_build_object('item_type','service','name','X','quantity','1','unit_price_cents',10000))));
  assert not test.throws(format($q$select public.prop_publish_revision(%L)$q$, r)), 'owner/admin sem limite de desconto';
  raise notice 'PASS: owner/admin sem limite de desconto';
end $$;
reset role;

-- ================= expiração =================
:as_s1
do $$
declare beta uuid := (select id from public.clients where name = 'Cliente Beta'); p uuid; r uuid; today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  p := public.prop_create_proposal(beta, 'Vai expirar');
  r := (select current_revision_id from public.proposals where id = p);
  perform public.prop_save_draft(r, jsonb_build_object('valid_until', today, 'items', jsonb_build_array(
    jsonb_build_object('item_type','service','name','X','quantity','1','unit_price_cents',5000))));
  perform public.prop_publish_revision(r);
  assert (select status from public.proposals where id = p) = 'sent', 'validade hoje ainda vale';
  assert public.prop_expire_overdue(current_setting('t.org')::uuid) = 0, 'nada vencido ainda';
  perform set_config('t.pe', p::text, true); perform set_config('t.re', r::text, true);
end $$;
reset role;

-- "passa o tempo": superusuário recua as datas da revisão (ignora gatilhos só neste teste)
set session_replication_role = replica;
update public.proposal_revisions set issue_date = issue_date - 5, valid_until = valid_until - 2 where id = current_setting('t.re')::uuid;
set session_replication_role = origin;

:as_s1
do $$
declare p uuid := current_setting('t.pe')::uuid;
begin
  assert public.prop_expire_overdue(current_setting('t.org')::uuid) = 1, 'uma proposta vencida expirada';
  assert (select status from public.proposals where id = p) = 'expired', 'status expirada';
  assert (select count(*) from public.proposal_events where proposal_id = p and event_type = 'expired') = 1, 'evento de expiração';
  assert public.prop_expire_overdue(current_setting('t.org')::uuid) = 0, 'idempotente';
  -- expirada pode ser renegociada: nova revisão e republicar
  perform public.prop_create_revision(p);
  assert (select valid_until from public.proposal_revisions where proposal_id = p and version_number = 2) >= (now() at time zone 'America/Sao_Paulo')::date, 'nova revisão com validade futura';
  perform public.prop_publish_revision((select current_revision_id from public.proposals where id = p));
  assert (select status from public.proposals where id = p) = 'sent', 'republicada volta a enviada';
  raise notice 'PASS: expiração por data, idempotente, e reabertura por nova revisão';
end $$;
reset role;

rollback;
