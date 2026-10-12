-- ============================================================================================
-- DADOS DE DEMONSTRAÇÃO — SOMENTE DESENVOLVIMENTO LOCAL
-- Executado automaticamente por `supabase db reset` (nunca no Supabase hospedado, a menos que você
-- rode este arquivo manualmente: NÃO faça isso em produção). Tudo aqui é FICTÍCIO e determinístico
-- (sem random()): rodar de novo gera sempre os mesmos dados. Para remover: apague a organização
-- "Empresa Demonstração" (as tabelas em cascata limpam o resto) ou rode `supabase db reset`.
-- As propostas são criadas pelas MESMAS funções que o sistema usa (numeração, snapshot, cálculo no banco);
-- só as datas são recuadas para o painel mostrar histórico.
--
-- Usuários de demonstração (senha local única: DemoLocal#2026):
--   dono@demo.exemplo       proprietário  (exige cadastrar verificação em duas etapas no primeiro acesso)
--   gerente@demo.exemplo    gerente       (vê todas as propostas, define metas)
--   vendedor1@demo.exemplo  vendedor      (vê só as próprias propostas)
--   vendedor2@demo.exemplo  vendedor
--   leitor@demo.exemplo     leitor        (somente leitura)
-- ============================================================================================

create function pg_temp.d(p_days_ago int, p_time time default '12:00') returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Sao_Paulo')::date - p_days_ago)::timestamp + p_time) at time zone 'America/Sao_Paulo'
$$;

-- Só no seed: desliga/religa os gatilhos de regra (dono das tabelas pode; o papel postgres do Supabase não é superusuário).
create function pg_temp.triggers(p_on boolean) returns void language plpgsql as $f$
begin
  execute format('alter table public.proposals %s trigger user', case when p_on then 'enable' else 'disable' end);
  execute format('alter table public.proposal_revisions %s trigger user', case when p_on then 'enable' else 'disable' end);
  execute format('alter table public.proposal_items %s trigger user', case when p_on then 'enable' else 'disable' end);
  execute format('alter table public.proposal_events %s trigger user', case when p_on then 'enable' else 'disable' end);
  execute format('alter table public.proposal_decisions %s trigger user', case when p_on then 'enable' else 'disable' end);
end $f$;

do $$
declare
  org uuid := 'd4d4d4d4-0000-4000-8000-000000000001';
  u_dono uuid := 'd4d4d4d4-0000-4000-8000-0000000000a1';
  u_ger uuid := 'd4d4d4d4-0000-4000-8000-0000000000a2';
  u_v1 uuid := 'd4d4d4d4-0000-4000-8000-0000000000a3';
  u_v2 uuid := 'd4d4d4d4-0000-4000-8000-0000000000a4';
  u_leitor uuid := 'd4d4d4d4-0000-4000-8000-0000000000a5';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
  names text[] := array['Alfa Tecnologia Ltda','Beta Alimentos S.A.','Gama Logística','Delta Saúde','Épsilon Educação','Zeta Construções','Eta Moda','Teta Energia','Iota Consultoria','Kappa Agro','Maria Souza (pessoa física)','João Pereira (pessoa física)'];
  docs text[] := array['11222333000181','11444777000161',null,null,null,null,null,null,null,null,'52998224725',null];
  client_ids uuid[] := '{}';
  cat_ids uuid[] := '{}';
  cat_prices bigint[] := array[18000, 15000, 9500, 250000, 32000, 12000, 89000, 4500, 120000, 6000];
  cat_names text[] := array['Consultoria estratégica (hora)','Desenvolvimento sob demanda (hora)','Suporte técnico (hora)','Implantação de sistema','Treinamento da equipe (turma)','Visita técnica','Licença anual do software','Material de apoio impresso','Projeto de identidade visual','Manutenção preventiva (visita)'];
  cat_types text[] := array['service','service','service','service','service','service','product','product','service','service'];
  cat_units text[] := array['h','h','h','un','turma','visita','un','un','un','visita'];
  titles text[] := array['Implantação do sistema de gestão','Consultoria de processos comerciais','Plano de manutenção anual','Projeto de identidade visual','Treinamento comercial','Licenciamento e suporte','Desenvolvimento de portal do cliente','Auditoria técnica de instalações','Campanha de lançamento','Reestruturação do atendimento'];
  tpl_ids uuid[];
  c uuid; p uuid; r uuid; n int; owner uuid; today date := (now() at time zone 'America/Sao_Paulo')::date;
  plan text; created_ago int; sent_ago int; decide_ago int; valid_days int; a int; b int; items jsonb; dis_pct text; content jsonb;
  sent_ts timestamptz; r_pub uuid; org_row public.organizations%rowtype; org_settings record;
begin
  if exists (select 1 from public.organizations where id = org) then
    return; -- já semeado
  end if;

  -- ---------------------------------------------------------------- usuários (login por e-mail e senha)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email, pw, now(),
         '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values (u_dono, 'dono@demo.exemplo', 'Marina Proprietária'), (u_ger, 'gerente@demo.exemplo', 'Rafael Gerente'),
               (u_v1, 'vendedor1@demo.exemplo', 'Camila Vendas'), (u_v2, 'vendedor2@demo.exemplo', 'Diego Vendas'),
               (u_leitor, 'leitor@demo.exemplo', 'Lívia Leitora')) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users u where u.id in (u_dono, u_ger, u_v1, u_v2, u_leitor);
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.id in (u_dono, u_ger, u_v1, u_v2, u_leitor);

  -- ---------------------------------------------------------------- organização (configuração e modelos nascem por gatilho)
  insert into public.organizations (id, name, slug) values (org, 'Empresa Demonstração (dados fictícios)', 'demo');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Empresa Demonstração', '{"primary":"#162a43"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, u_dono, 'owner'), (org, u_ger, 'manager'), (org, u_v1, 'member'), (org, u_v2, 'member'), (org, u_leitor, 'viewer');
  update public.proposal_settings set
    legal_name = 'Empresa Demonstração Serviços Ltda', document_number = '11222333000181', email = 'comercial@demo.exemplo', phone = '(11) 4000-1000',
    address = 'Av. Exemplo, 1000 — São Paulo/SP', footer_text = 'Documento de demonstração com dados fictícios.', number_prefix = '',
    default_terms = E'Pagamento em até 30 dias após o aceite.\nOs prazos começam após a aprovação desta proposta.\nAs condições valem pelo prazo de validade indicado.'
  where organization_id = org;
  select array_agg(id order by base) into tpl_ids from public.proposal_templates where organization_id = org;   -- agency, corporate, technical

  -- ---------------------------------------------------------------- clientes e catálogo
  for n in 1..12 loop
    insert into public.clients (organization_id, type, name, legal_name, document_number, email, phone, address, created_at)
    values (org, case when n >= 11 then 'person' else 'company' end::public.client_type, names[n], case when n < 11 then names[n] end, docs[n],
            format('contato%s@cliente-demo.invalid', n), format('(11) 3000-%s', lpad((2000 + n)::text, 4, '0')), format('Rua Exemplo, %s — São Paulo/SP', n * 10), now() - (120 - n * 5) * interval '1 day')
    returning id into c;
    client_ids := client_ids || c;
  end loop;
  for n in 1..10 loop
    insert into public.catalog_items (organization_id, type, name, sku, unit, default_price_cents, description)
    values (org, cat_types[n]::public.catalog_item_type, cat_names[n], format('ITEM-%s', lpad(n::text, 3, '0')), cat_units[n], cat_prices[n], 'Item de demonstração.')
    returning id into c;
    cat_ids := cat_ids || c;
  end loop;

  -- ---------------------------------------------------------------- 30 propostas pelas funções do sistema
  -- plano por posição (n): A=aceita, R=recusada, V=visualizada, S=enviada sem abrir, E=expirada, D=rascunho, X=aceita na versão 2
  for n in 1..30 loop
    plan := (array['A','A','R','A','V','E','S','D','A','R','X','A','R','S','A','E','A','V','R','A','X','A','A','R','S','V','A','D','A','R'])[n];
    owner := (array[u_v1, u_v2, u_v1, u_v2, u_ger])[(n % 5) + 1];
    created_ago := 98 - n * 3;                         -- n=1 -> 95 dias; n=30 -> 8 dias
    sent_ago := greatest(created_ago - 1, 1);
    decide_ago := greatest(sent_ago - (2 + n % 6), 0);
    valid_days := 30;
    if plan in ('V', 'S') then created_ago := 8 - (n % 4); sent_ago := created_ago; valid_days := 18 - n % 5; end if;
    if n = 14 then sent_ago := 9; created_ago := 10; end if;                       -- enviada há 9 dias, sem retorno
    if n = 26 then valid_days := 3; sent_ago := 4; created_ago := 5; end if;        -- vence em 3 dias
    if plan = 'D' then created_ago := 3 + n % 3; end if;

    perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'aal', 'aal2')::text, true);
    p := public.prop_create_proposal(client_ids[((n - 1) % 12) + 1], titles[((n - 1) % 10) + 1], tpl_ids[((n - 1) % 3) + 1], owner);
    r := (select current_revision_id from public.proposals where id = p);
    a := ((n * 3) % 10) + 1; b := ((n * 7) % 10) + 1;
    if b = a then b := (b % 10) + 1; end if;
    dis_pct := case when n % 4 = 0 then '5' when n % 6 = 0 then '6' else '0' end;
    items := jsonb_build_array(
      jsonb_build_object('catalog_item_id', cat_ids[a], 'item_type', cat_types[a], 'name', cat_names[a], 'unit', cat_units[a], 'quantity', (case when cat_units[a] = 'h' then 8 + n % 24 else 1 + n % 3 end)::text,
                         'unit_price_cents', cat_prices[a], 'discount_kind', case when dis_pct = '0' then 'none' else 'percent' end, 'discount_value', dis_pct),
      jsonb_build_object('catalog_item_id', cat_ids[b], 'item_type', cat_types[b], 'name', cat_names[b], 'unit', cat_units[b], 'quantity', (case when cat_units[b] = 'h' then 4 + n % 16 else 1 + n % 2 end)::text,
                         'unit_price_cents', cat_prices[b], 'discount_kind', 'none', 'discount_value', '0'));
    content := (select content_json from public.proposal_revisions where id = r);
    content := jsonb_set(content, '{sections}', (
      select coalesce(jsonb_agg(case s ->> 'kind'
          when 'presentation' then jsonb_set(s, '{content}', private.prop_text_to_doc('Somos uma empresa de demonstração e preparamos esta proposta para ' || rtrim(names[((n - 1) % 12) + 1], '.') || '.'))
          when 'objective' then jsonb_set(s, '{content}', private.prop_text_to_doc('Atender às necessidades levantadas com entregas claras e prazos acordados.'))
          when 'scope' then jsonb_set(s, '{content}', private.prop_text_to_doc(E'Planejamento e execução dos serviços descritos na tabela de investimento.\nAcompanhamento durante toda a vigência.'))
          when 'deliverables' then jsonb_set(s, '{content}', private.prop_text_to_doc(E'Relatório de entrega\nTreinamento básico da equipe'))
          else s end), '[]'::jsonb) from jsonb_array_elements(content -> 'sections') s));
    perform public.prop_save_draft(r, jsonb_build_object('items', items, 'content_json', content,
        'discount', jsonb_build_object('kind', case when n % 9 = 0 then 'percent' else 'none' end, 'value', case when n % 9 = 0 then '3' else '0' end),
        'charges', case when n % 5 = 0 then jsonb_build_array(jsonb_build_object('label', 'Taxa de implantação', 'kind', 'fixed', 'value', '15000')) else '[]'::jsonb end,
        'valid_until', today + valid_days));
    if plan <> 'D' then
      perform public.prop_publish_revision(r);
      if plan = 'X' then   -- segunda versão com ajuste de quantidade, depois aceita
        perform public.prop_create_revision(p);
        perform public.prop_save_draft((select current_revision_id from public.proposals where id = p),
          jsonb_build_object('items', jsonb_set(items, '{0,quantity}', '"2"'), 'valid_until', today + valid_days));
        perform public.prop_publish_revision((select current_revision_id from public.proposals where id = p));
      end if;
    end if;

    -- datas históricas (só no seed: o sistema nunca faz isso)
    perform pg_temp.triggers(false);
    update public.proposals set created_at = pg_temp.d(created_ago), first_sent_at = case when plan <> 'D' then pg_temp.d(sent_ago) end where id = p;
    update public.proposal_revisions set created_at = pg_temp.d(created_ago) where proposal_id = p;
    update public.proposal_events set created_at = pg_temp.d(created_ago) where proposal_id = p and event_type = 'created';
    update public.proposal_events set created_at = pg_temp.d(sent_ago) where proposal_id = p and event_type in ('published', 'sent', 'revised');
    if plan <> 'D' then
      r_pub := (select published_revision_id from public.proposals where id = p);
      update public.proposal_revisions set issue_date = pg_temp.d(sent_ago)::date, valid_until = case when plan = 'E' then pg_temp.d(sent_ago - 10)::date when plan in ('V', 'S') then (today + valid_days) else pg_temp.d(sent_ago - 30)::date end,
             published_at = pg_temp.d(sent_ago),
             snapshot_json = jsonb_set(jsonb_set(snapshot_json, '{revision,issue_date}', to_jsonb(pg_temp.d(sent_ago)::date::text)), '{revision,valid_until}',
               to_jsonb((case when plan = 'E' then pg_temp.d(sent_ago - 10)::date when plan in ('V', 'S') then (today + valid_days) else pg_temp.d(sent_ago - 30)::date end)::text))
       where id = r_pub;
      if plan = 'X' then
        update public.proposal_revisions set issue_date = pg_temp.d(sent_ago + 6)::date, valid_until = pg_temp.d(sent_ago - 30)::date, published_at = pg_temp.d(sent_ago + 6),
               snapshot_json = jsonb_set(jsonb_set(snapshot_json, '{revision,issue_date}', to_jsonb(pg_temp.d(sent_ago + 6)::date::text)), '{revision,valid_until}', to_jsonb(pg_temp.d(sent_ago - 30)::date::text))
         where proposal_id = p and version_number = 1;
      end if;
      if plan in ('A', 'X', 'R') then
        insert into public.proposal_decisions (organization_id, proposal_id, revision_id, decision, client_name, client_email, comment, created_at)
        values (org, p, r_pub, case when plan = 'R' then 'declined' else 'accepted' end::public.proposal_decision_kind, 'Contato do cliente ' || ((n - 1) % 12 + 1), format('contato%s@cliente-demo.invalid', (n - 1) % 12 + 1),
                case when plan = 'R' then 'Fora do orçamento neste momento.' when n % 3 = 0 then 'De acordo.' end, pg_temp.d(decide_ago));
        update public.proposals set status = case when plan = 'R' then 'declined' else 'accepted' end::public.proposal_status where id = p;
        insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, created_at)
        values (org, p, r_pub, case when plan = 'R' then 'declined' else 'accepted' end, pg_temp.d(decide_ago));
        insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, created_at, metadata) values (org, p, r_pub, 'viewed', pg_temp.d(decide_ago + 1), '{}');
      elsif plan = 'V' then
        update public.proposals set status = 'viewed' where id = p;
        insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, created_at) values (org, p, r_pub, 'viewed', pg_temp.d(greatest(sent_ago - 1, 0)));
      elsif plan = 'E' then
        update public.proposals set status = 'expired' where id = p;
        insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, created_at) values (org, p, r_pub, 'expired', pg_temp.d(sent_ago - 10));
      end if;
    end if;
    perform pg_temp.triggers(true);
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------- metas do mês corrente
  insert into public.commercial_goals (organization_id, user_id, period_start, period_end, target_value_cents) values
    (org, u_v1, date_trunc('month', today)::date, (date_trunc('month', today) + interval '1 month - 1 day')::date, 4000000),
    (org, u_v2, date_trunc('month', today)::date, (date_trunc('month', today) + interval '1 month - 1 day')::date, 3000000);
end $$;
