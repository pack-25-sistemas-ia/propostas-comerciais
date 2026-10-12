-- Gestão de Propostas Comerciais — FLUXO (parte 2): criar, salvar, publicar, revisar, cancelar, compartilhar, decidir.
-- Tudo o que muda status, número, revisão ou publica passa por estas funções (security definer, search_path vazio,
-- permissão e MFA verificados DENTRO de cada uma). Elas são a única porta de escrita dessas tabelas.
-- O visitante (anon) só executa as duas funções públicas, identificadas pelo hash do token.

begin;

-- ======================================================================= utilitários
create function private.prop_event(p_org uuid, p_proposal uuid, p_revision uuid, p_type text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, actor_id, metadata)
  values (p_org, p_proposal, p_revision, p_type, (select auth.uid()), coalesce(p_meta, '{}'::jsonb));
$$;
revoke all on function private.prop_event(uuid, uuid, uuid, text, jsonb) from public;

-- Texto simples (uma linha = um parágrafo) -> documento ProseMirror.
create function private.prop_text_to_doc(p_text text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('type', 'doc', 'content', coalesce(jsonb_agg(
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', btrim(l))))), '[]'::jsonb))
  from regexp_split_to_table(coalesce(p_text, ''), E'\n') l where btrim(l) <> '';
$$;

-- Seções iniciais conforme o modelo (e as condições padrão da empresa).
create function private.prop_initial_content(p_template public.proposal_templates, p_terms text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('sections', coalesce(jsonb_agg(jsonb_build_object(
    'id', gen_random_uuid()::text,
    'kind', s.value ->> 'kind',
    'title', s.value ->> 'title',
    'enabled', coalesce((s.value ->> 'enabled')::boolean, true),
    'content', case when s.value ->> 'kind' = 'terms' then private.prop_text_to_doc(p_terms)
                    else '{"type":"doc","content":[]}'::jsonb end) order by s.ordinality), '[]'::jsonb))
  from jsonb_array_elements(coalesce(p_template.structure_json -> 'sections', '[]'::jsonb)) with ordinality s;
$$;

create function private.prop_assert_writer(p_org uuid, p_owner uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.prop_can_write_owned(p_org, p_owner) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if not private.mfa_ok() then
    raise exception 'verificação em duas etapas necessária' using errcode = '42501';
  end if;
end $$;
revoke all on function private.prop_assert_writer(uuid, uuid) from public;

-- ======================================================================= criar proposta
create function public.prop_create_proposal(p_client uuid, p_title text, p_template uuid default null, p_owner uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.clients%rowtype; s public.proposal_settings%rowtype; tpl public.proposal_templates%rowtype;
  v_owner uuid; pid uuid; rid uuid; v_title text := btrim(coalesce(p_title, ''));
begin
  select * into c from public.clients where id = p_client;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  if not private.has_role(c.organization_id, array['owner','admin','manager','member']::public.org_role[]) or not private.mfa_ok() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if c.archived_at is not null then raise exception 'cliente arquivado' using errcode = '23514'; end if;
  if char_length(v_title) not between 2 and 160 then raise exception 'título deve ter de 2 a 160 caracteres' using errcode = '22023'; end if;
  v_owner := coalesce(p_owner, (select auth.uid()));
  if private.prop_role(c.organization_id) = 'member' and v_owner is distinct from (select auth.uid()) then
    raise exception 'vendedor só cria propostas em seu nome' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members m where m.organization_id = c.organization_id and m.user_id = v_owner) then
    raise exception 'responsável inválido' using errcode = '22023';
  end if;
  select * into s from public.proposal_settings where organization_id = c.organization_id;
  select * into tpl from public.proposal_templates t
   where t.organization_id = c.organization_id and ((p_template is not null and t.id = p_template) or (p_template is null and t.is_default));
  if p_template is not null and not found then raise exception 'modelo não encontrado' using errcode = 'P0002'; end if;

  insert into public.proposals (organization_id, client_id, owner_id, title) values (c.organization_id, c.id, v_owner, v_title) returning id into pid;
  insert into public.proposal_revisions (organization_id, proposal_id, version_number, template_id, content_json, issue_date, valid_until)
  values (c.organization_id, pid, 1, tpl.id, private.prop_initial_content(tpl, s.default_terms), private.prop_today(), private.prop_today() + s.default_validity_days)
  returning id into rid;
  update public.proposals set current_revision_id = rid where id = pid;
  perform private.prop_event(c.organization_id, pid, rid, 'created');
  return pid;
end $$;

-- ======================================================================= salvar rascunho
-- Payload PARCIAL: chave ausente = mantém o que já está salvo (itens, desconto e encargos inclusive).
-- Payload: {title, client_id?, template_id?, content_json, issue_date, valid_until, discount:{kind,value},
--           charges:[{label,kind,value}], items:[{catalog_item_id?, item_type, name, description?, unit, quantity,
--           unit_price_cents, discount_kind, discount_value}]}. Totais calculados AQUI (prop_compute), nunca aceitos do cliente.
create function public.prop_save_draft(p_revision uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rev public.proposal_revisions%rowtype; prop public.proposals%rowtype; calc jsonb;
  v_title text; v_client uuid; v_template uuid; v_content jsonb; v_issue date; v_valid date;
  v_dkind public.discount_kind; v_dval numeric; v_charges jsonb; v_items jsonb;
  it record;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  select * into rev from public.proposal_revisions where id = p_revision for update;
  if not found then raise exception 'revisão não encontrada' using errcode = 'P0002'; end if;
  select * into prop from public.proposals where id = rev.proposal_id for update;
  perform private.prop_assert_writer(prop.organization_id, prop.owner_id);
  if rev.published_at is not null then raise exception 'revisão publicada é imutável' using errcode = '23514'; end if;
  if prop.archived_at is not null then raise exception 'proposta arquivada' using errcode = '23514'; end if;

  v_title := btrim(coalesce(p_payload ->> 'title', prop.title));
  if char_length(v_title) not between 2 and 160 then raise exception 'título deve ter de 2 a 160 caracteres' using errcode = '22023'; end if;
  v_content := coalesce(p_payload -> 'content_json', rev.content_json);
  if jsonb_typeof(v_content) <> 'object' or jsonb_typeof(coalesce(v_content -> 'sections', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(v_content -> 'sections', '[]'::jsonb)) > 30 then
    raise exception 'conteúdo inválido' using errcode = '22023';
  end if;
  v_template := case when p_payload ? 'template_id' then nullif(p_payload ->> 'template_id', '')::uuid else rev.template_id end;
  v_issue := coalesce(nullif(p_payload ->> 'issue_date', '')::date, rev.issue_date);
  v_valid := case when p_payload ? 'valid_until' then nullif(p_payload ->> 'valid_until', '')::date else rev.valid_until end;
  if v_valid is not null and v_valid < v_issue then raise exception 'a validade não pode ser anterior à emissão' using errcode = '22023'; end if;
  v_dkind := case when p_payload ? 'discount' then coalesce(p_payload -> 'discount' ->> 'kind', 'none')::public.discount_kind else rev.discount_kind end;
  v_dval := case when p_payload ? 'discount' then coalesce((p_payload -> 'discount' ->> 'value')::numeric, 0) else rev.discount_value end;
  v_charges := case when p_payload ? 'charges' then coalesce(p_payload -> 'charges', '[]'::jsonb) else rev.charges end;
  if p_payload ? 'items' then
    v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  else
    select coalesce(jsonb_agg(jsonb_build_object('quantity', x.quantity, 'unit_price_cents', x.unit_price_cents,
        'discount_kind', x.discount_kind, 'discount_value', x.discount_value) order by x.position), '[]'::jsonb)
      into v_items from public.proposal_items x where x.revision_id = rev.id;
  end if;

  calc := public.prop_compute(v_items, jsonb_build_object('kind', v_dkind, 'value', v_dval), v_charges);

  if p_payload ? 'items' then
  delete from public.proposal_items where revision_id = rev.id;
  for it in select e.value as v, e.ordinality as n from jsonb_array_elements(v_items) with ordinality e loop
    insert into public.proposal_items (organization_id, revision_id, catalog_item_id, item_type, name, description, unit, quantity,
        unit_price_cents, discount_kind, discount_value, gross_cents, discount_cents, total_cents, position)
    values (rev.organization_id, rev.id, nullif(it.v ->> 'catalog_item_id', '')::uuid,
        coalesce(it.v ->> 'item_type', 'service')::public.catalog_item_type, btrim(it.v ->> 'name'), nullif(btrim(it.v ->> 'description'), ''),
        coalesce(nullif(btrim(it.v ->> 'unit'), ''), 'un'), (it.v ->> 'quantity')::numeric, (it.v ->> 'unit_price_cents')::bigint,
        coalesce(it.v ->> 'discount_kind', 'none')::public.discount_kind, coalesce((it.v ->> 'discount_value')::numeric, 0),
        (calc -> 'items' -> (it.n::int - 1) ->> 'gross_cents')::bigint, (calc -> 'items' -> (it.n::int - 1) ->> 'discount_cents')::bigint,
        (calc -> 'items' -> (it.n::int - 1) ->> 'total_cents')::bigint, it.n::int - 1);
  end loop;
  else
    update public.proposal_items i set gross_cents = (c.value ->> 'gross_cents')::bigint, discount_cents = (c.value ->> 'discount_cents')::bigint,
           total_cents = (c.value ->> 'total_cents')::bigint
      from jsonb_array_elements(calc -> 'items') with ordinality c where i.revision_id = rev.id and i.position = c.ordinality::int - 1;
  end if;

  update public.proposal_revisions set
    template_id = v_template, content_json = v_content, issue_date = v_issue, valid_until = v_valid,
    discount_kind = v_dkind, discount_value = v_dval, charges = v_charges,
    subtotal_cents = (calc ->> 'subtotal_cents')::bigint, items_discount_cents = (calc ->> 'items_discount_cents')::bigint,
    discount_cents = (calc ->> 'discount_cents')::bigint, additional_charges_cents = (calc ->> 'additional_charges_cents')::bigint,
    total_cents = (calc ->> 'total_cents')::bigint
  where id = rev.id;

  v_client := case when p_payload ? 'client_id' then nullif(p_payload ->> 'client_id', '')::uuid else prop.client_id end;
  if v_client is distinct from prop.client_id and prop.status <> 'draft' then
    raise exception 'o cliente só pode ser trocado antes da primeira publicação' using errcode = '23514';
  end if;
  update public.proposals set title = v_title, client_id = coalesce(v_client, prop.client_id) where id = prop.id;
  return calc;
end $$;

-- ======================================================================= publicar
create function public.prop_publish_revision(p_revision uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rev public.proposal_revisions%rowtype; prop public.proposals%rowtype; s public.proposal_settings%rowtype;
  cl public.clients%rowtype; tpl public.proposal_templates%rowtype;
  v_role public.org_role; v_limit numeric; v_pct numeric; v_items jsonb; v_calc jsonb; v_snap_items jsonb;
  v_org_name text; v_first boolean; v_today date := private.prop_today();
begin
  select * into rev from public.proposal_revisions where id = p_revision for update;
  if not found then raise exception 'revisão não encontrada' using errcode = 'P0002'; end if;
  select * into prop from public.proposals where id = rev.proposal_id for update;
  perform private.prop_assert_writer(prop.organization_id, prop.owner_id);
  if rev.published_at is not null then raise exception 'revisão já publicada' using errcode = '23514'; end if;
  if prop.archived_at is not null then raise exception 'proposta arquivada' using errcode = '23514'; end if;
  if prop.status in ('accepted', 'cancelled') then raise exception 'proposta encerrada' using errcode = '23514'; end if;
  if rev.id is distinct from prop.current_revision_id then raise exception 'só a revisão atual pode ser publicada' using errcode = '23514'; end if;
  select * into cl from public.clients where id = prop.client_id;
  if cl.archived_at is not null then raise exception 'cliente arquivado' using errcode = '23514'; end if;
  if rev.valid_until is null or rev.valid_until < v_today then raise exception 'informe uma validade futura' using errcode = '23514'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('position', x.position, 'catalog_item_id', x.catalog_item_id, 'item_type', x.item_type,
      'name', x.name, 'description', x.description, 'unit', x.unit, 'quantity', x.quantity, 'unit_price_cents', x.unit_price_cents,
      'discount_kind', x.discount_kind, 'discount_value', x.discount_value) order by x.position), '[]'::jsonb)
    into v_items from public.proposal_items x where x.revision_id = rev.id;
  if jsonb_array_length(v_items) = 0 then raise exception 'adicione ao menos um item' using errcode = '23514'; end if;

  v_calc := public.prop_compute(v_items, jsonb_build_object('kind', rev.discount_kind, 'value', rev.discount_value), rev.charges);

  -- limite de desconto por perfil (percentual do bruto)
  select * into s from public.proposal_settings where organization_id = prop.organization_id;
  v_role := private.prop_role(prop.organization_id);
  v_limit := case v_role when 'member' then s.max_discount_member_pct when 'manager' then s.max_discount_manager_pct else null end;
  if v_limit is not null and (v_calc ->> 'gross_cents')::numeric > 0 then
    v_pct := ((v_calc ->> 'items_discount_cents')::numeric + (v_calc ->> 'discount_cents')::numeric) * 100 / (v_calc ->> 'gross_cents')::numeric;
    if v_pct > v_limit then
      raise exception 'desconto de % acima do limite do seu perfil (% )', round(v_pct, 2), v_limit using errcode = '23514';
    end if;
  end if;

  select * into tpl from public.proposal_templates t
   where t.organization_id = prop.organization_id and (t.id = rev.template_id or (rev.template_id is null and t.is_default)) limit 1;
  select coalesce(os.display_name, o.name) into v_org_name
    from public.organizations o left join public.organization_settings os on os.organization_id = o.id where o.id = prop.organization_id;

  update public.proposal_items i set gross_cents = (c.value ->> 'gross_cents')::bigint, discount_cents = (c.value ->> 'discount_cents')::bigint,
         total_cents = (c.value ->> 'total_cents')::bigint
    from jsonb_array_elements(v_calc -> 'items') with ordinality c where i.revision_id = rev.id and i.position = c.ordinality::int - 1;

  select coalesce(jsonb_agg(a.value || b.value order by a.ordinality), '[]'::jsonb) into v_snap_items
    from jsonb_array_elements(v_items) with ordinality a join jsonb_array_elements(v_calc -> 'items') with ordinality b using (ordinality);

  update public.proposal_revisions set
    subtotal_cents = (v_calc ->> 'subtotal_cents')::bigint, items_discount_cents = (v_calc ->> 'items_discount_cents')::bigint,
    discount_cents = (v_calc ->> 'discount_cents')::bigint, additional_charges_cents = (v_calc ->> 'additional_charges_cents')::bigint,
    total_cents = (v_calc ->> 'total_cents')::bigint, template_id = coalesce(template_id, tpl.id), published_at = now(),
    snapshot_json = jsonb_build_object(
      'schema', 1,
      'proposal', jsonb_build_object('number', prop.proposal_number, 'title', prop.title, 'currency', prop.currency),
      'revision', jsonb_build_object('version', rev.version_number, 'issue_date', rev.issue_date, 'valid_until', rev.valid_until),
      'company', jsonb_build_object('name', v_org_name, 'legal_name', s.legal_name, 'document_number', s.document_number, 'email', s.email,
          'phone', s.phone, 'address', s.address, 'footer_text', s.footer_text, 'primary_color', s.primary_color,
          'secondary_color', s.secondary_color, 'logo_data_url', s.logo_data_url),
      'client', jsonb_build_object('type', cl.type, 'name', cl.name, 'legal_name', cl.legal_name, 'document_number', cl.document_number,
          'email', cl.email, 'phone', cl.phone, 'address', cl.address),
      'template', jsonb_build_object('base', coalesce(tpl.base, 'corporate'), 'name', tpl.name, 'style', coalesce(tpl.style_json, '{}'::jsonb)),
      'content', rev.content_json,
      'items', v_snap_items,
      'pricing', jsonb_build_object('currency', 'BRL', 'gross_cents', v_calc -> 'gross_cents', 'items_discount_cents', v_calc -> 'items_discount_cents',
          'subtotal_cents', v_calc -> 'subtotal_cents',
          'discount', jsonb_build_object('kind', rev.discount_kind, 'value', rev.discount_value, 'amount_cents', v_calc -> 'discount_cents'),
          'charges', v_calc -> 'charges', 'total_cents', v_calc -> 'total_cents'))
  where id = rev.id;

  v_first := prop.first_sent_at is null;
  update public.proposals set published_revision_id = rev.id, current_revision_id = rev.id, status = 'sent',
         first_sent_at = coalesce(first_sent_at, now())
   where id = prop.id;
  update public.proposal_share_links set revoked_at = now() where proposal_id = prop.id and revoked_at is null and revision_id <> rev.id;

  perform private.prop_event(prop.organization_id, prop.id, rev.id, 'published', jsonb_build_object('version', rev.version_number));
  if v_first then perform private.prop_event(prop.organization_id, prop.id, rev.id, 'sent'); end if;
  return jsonb_build_object('revision_id', rev.id, 'version', rev.version_number, 'total_cents', v_calc -> 'total_cents');
end $$;

-- ======================================================================= nova revisão (a partir da publicada)
create function public.prop_create_revision(p_proposal uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  prop public.proposals%rowtype; rev public.proposal_revisions%rowtype; s public.proposal_settings%rowtype;
  v_new uuid; v_today date := private.prop_today();
begin
  select * into prop from public.proposals where id = p_proposal for update;
  if not found then raise exception 'proposta não encontrada' using errcode = 'P0002'; end if;
  perform private.prop_assert_writer(prop.organization_id, prop.owner_id);
  if prop.status in ('accepted', 'cancelled') then raise exception 'proposta encerrada: duplique-a para negociar de novo' using errcode = '23514'; end if;
  if prop.archived_at is not null then raise exception 'proposta arquivada' using errcode = '23514'; end if;
  select * into rev from public.proposal_revisions where id = prop.current_revision_id for update;
  if rev.published_at is null then raise exception 'já existe uma revisão em edição' using errcode = '23514'; end if;
  select * into s from public.proposal_settings where organization_id = prop.organization_id;

  insert into public.proposal_revisions (organization_id, proposal_id, version_number, template_id, content_json, discount_kind, discount_value, charges,
      subtotal_cents, items_discount_cents, discount_cents, additional_charges_cents, total_cents, issue_date, valid_until)
  values (rev.organization_id, rev.proposal_id, rev.version_number + 1, rev.template_id, rev.content_json, rev.discount_kind, rev.discount_value, rev.charges,
      rev.subtotal_cents, rev.items_discount_cents, rev.discount_cents, rev.additional_charges_cents, rev.total_cents, v_today,
      case when rev.valid_until >= v_today then rev.valid_until else v_today + s.default_validity_days end)
  returning id into v_new;
  insert into public.proposal_items (organization_id, revision_id, catalog_item_id, item_type, name, description, unit, quantity, unit_price_cents,
      discount_kind, discount_value, gross_cents, discount_cents, total_cents, position)
  select organization_id, v_new, catalog_item_id, item_type, name, description, unit, quantity, unit_price_cents,
      discount_kind, discount_value, gross_cents, discount_cents, total_cents, position
  from public.proposal_items where revision_id = rev.id;
  update public.proposals set current_revision_id = v_new where id = prop.id;
  perform private.prop_event(prop.organization_id, prop.id, v_new, 'revised', jsonb_build_object('version', rev.version_number + 1));
  return v_new;
end $$;

-- ======================================================================= cancelar
create function public.prop_cancel(p_proposal uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare prop public.proposals%rowtype;
begin
  select * into prop from public.proposals where id = p_proposal for update;
  if not found then raise exception 'proposta não encontrada' using errcode = 'P0002'; end if;
  perform private.prop_assert_writer(prop.organization_id, prop.owner_id);
  if prop.status in ('accepted', 'cancelled') then raise exception 'proposta já encerrada' using errcode = '23514'; end if;
  update public.proposals set status = 'cancelled' where id = prop.id;
  update public.proposal_share_links set revoked_at = now() where proposal_id = prop.id and revoked_at is null;
  perform private.prop_event(prop.organization_id, prop.id, prop.current_revision_id, 'cancelled',
      jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 300)));
end $$;

-- ======================================================================= duplicar
create function public.prop_duplicate(p_proposal uuid, p_client uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  src public.proposals%rowtype; rev public.proposal_revisions%rowtype; s public.proposal_settings%rowtype; c public.clients%rowtype;
  v_pid uuid; v_rid uuid; v_today date := private.prop_today();
begin
  select * into src from public.proposals where id = p_proposal;
  if not found or not private.prop_can_read_owned(src.organization_id, src.owner_id) then
    raise exception 'proposta não encontrada' using errcode = 'P0002';
  end if;
  if not private.has_role(src.organization_id, array['owner','admin','manager','member']::public.org_role[]) or not private.mfa_ok() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select * into c from public.clients where id = coalesce(p_client, src.client_id) and organization_id = src.organization_id;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  if c.archived_at is not null then raise exception 'cliente arquivado' using errcode = '23514'; end if;
  select * into rev from public.proposal_revisions where id = src.current_revision_id;
  select * into s from public.proposal_settings where organization_id = src.organization_id;

  insert into public.proposals (organization_id, client_id, owner_id, title)
  values (src.organization_id, c.id, (select auth.uid()), left(src.title, 160)) returning id into v_pid;
  insert into public.proposal_revisions (organization_id, proposal_id, version_number, template_id, content_json, discount_kind, discount_value, charges,
      subtotal_cents, items_discount_cents, discount_cents, additional_charges_cents, total_cents, issue_date, valid_until)
  values (src.organization_id, v_pid, 1, rev.template_id, rev.content_json, rev.discount_kind, rev.discount_value, rev.charges,
      rev.subtotal_cents, rev.items_discount_cents, rev.discount_cents, rev.additional_charges_cents, rev.total_cents, v_today, v_today + s.default_validity_days)
  returning id into v_rid;
  insert into public.proposal_items (organization_id, revision_id, catalog_item_id, item_type, name, description, unit, quantity, unit_price_cents,
      discount_kind, discount_value, gross_cents, discount_cents, total_cents, position)
  select organization_id, v_rid, catalog_item_id, item_type, name, description, unit, quantity, unit_price_cents,
      discount_kind, discount_value, gross_cents, discount_cents, total_cents, position
  from public.proposal_items where revision_id = rev.id;
  update public.proposals set current_revision_id = v_rid where id = v_pid;
  perform private.prop_event(src.organization_id, v_pid, v_rid, 'created', jsonb_build_object('duplicated_from', src.proposal_number));
  return v_pid;
end $$;

-- ======================================================================= links de compartilhamento
-- O token (256 bits) é gerado no servidor da aplicação; aqui só chega o SHA-256 em hexadecimal.
create function public.prop_create_share_link(p_proposal uuid, p_token_hash text, p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare prop public.proposals%rowtype; v_id uuid;
begin
  select * into prop from public.proposals where id = p_proposal for update;
  if not found then raise exception 'proposta não encontrada' using errcode = 'P0002'; end if;
  perform private.prop_assert_writer(prop.organization_id, prop.owner_id);
  if prop.status not in ('sent', 'viewed') or prop.published_revision_id is null then
    raise exception 'só propostas enviadas podem ser compartilhadas' using errcode = '23514';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '400 days' then
    raise exception 'validade do link inválida' using errcode = '22023';
  end if;
  insert into public.proposal_share_links (organization_id, proposal_id, revision_id, token_hash, expires_at)
  values (prop.organization_id, prop.id, prop.published_revision_id, p_token_hash, p_expires_at) returning id into v_id;
  perform private.prop_event(prop.organization_id, prop.id, prop.published_revision_id, 'link_created');
  return v_id;
end $$;

create function public.prop_revoke_share_link(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.proposal_share_links%rowtype; prop public.proposals%rowtype;
begin
  select * into l from public.proposal_share_links where id = p_link for update;
  if not found then raise exception 'link não encontrado' using errcode = 'P0002'; end if;
  select * into prop from public.proposals where id = l.proposal_id;
  perform private.prop_assert_writer(prop.organization_id, prop.owner_id);
  if l.revoked_at is null then
    update public.proposal_share_links set revoked_at = now() where id = l.id;
    perform private.prop_event(prop.organization_id, prop.id, l.revision_id, 'link_revoked');
  end if;
end $$;

-- ======================================================================= expiração
create function private.prop_expire_one(p_proposal uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare prop public.proposals%rowtype; rev public.proposal_revisions%rowtype;
begin
  select * into prop from public.proposals where id = p_proposal for update;
  if not found or prop.status not in ('sent', 'viewed') then return; end if;
  select * into rev from public.proposal_revisions where id = prop.published_revision_id;
  if rev.valid_until is not null and rev.valid_until < private.prop_today() then
    update public.proposals set status = 'expired' where id = prop.id;
    insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, actor_id)
    values (prop.organization_id, prop.id, rev.id, 'expired', null);
  end if;
end $$;
revoke all on function private.prop_expire_one(uuid) from public;

create function public.prop_expire_overdue(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not private.is_member(p_org) then raise exception 'sem permissão' using errcode = '42501'; end if;
  with x as (
    update public.proposals p set status = 'expired'
    from public.proposal_revisions r
    where p.organization_id = p_org and p.status in ('sent', 'viewed') and r.id = p.published_revision_id and r.valid_until < private.prop_today()
    returning p.id, p.organization_id, p.published_revision_id
  ), ins as (
    insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, actor_id)
    select organization_id, id, published_revision_id, 'expired', null from x returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

-- ======================================================================= acesso público (token)
-- Resposta uniforme para link inexistente, revogado ou vencido: {"state":"unavailable"} (sem enumeração).
create function public.prop_public_view(p_token_hash text, p_human boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.proposal_share_links%rowtype; prop public.proposals%rowtype; rev public.proposal_revisions%rowtype;
  d public.proposal_decisions%rowtype; v_state text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'unavailable'); end if;
  select * into l from public.proposal_share_links where token_hash = p_token_hash;
  if not found or l.revoked_at is not null or l.expires_at <= now() then return jsonb_build_object('state', 'unavailable'); end if;

  perform private.prop_expire_one(l.proposal_id);
  select * into prop from public.proposals where id = l.proposal_id for update;
  select * into rev from public.proposal_revisions where id = l.revision_id;
  select * into d from public.proposal_decisions where revision_id = l.revision_id;

  v_state := case
    when prop.status = 'cancelled' then 'cancelled'
    when l.revision_id is distinct from prop.published_revision_id then 'superseded'
    when d.id is not null then 'decided'
    when prop.status = 'expired' then 'expired'
    else 'open' end;

  if v_state = 'open' and p_human then
    if prop.status = 'sent' then update public.proposals set status = 'viewed' where id = prop.id; end if;
    if not exists (select 1 from public.proposal_events e where e.proposal_id = prop.id and e.event_type = 'viewed'
                   and e.metadata ->> 'link' = l.id::text and e.created_at > now() - interval '10 minutes') then
      insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, actor_id, metadata)
      values (prop.organization_id, prop.id, rev.id, 'viewed', null, jsonb_build_object('link', l.id));
    end if;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'number', prop.proposal_number,
    'valid_until', rev.valid_until,
    'snapshot', case when v_state in ('open', 'decided', 'expired') then rev.snapshot_json end,
    'decision', case when d.id is not null then jsonb_build_object('decision', d.decision, 'decided_at', d.created_at) end);
end $$;

create function public.prop_public_decide(p_token_hash text, p_decision text, p_name text, p_email text, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.proposal_share_links%rowtype; prop public.proposals%rowtype; rev public.proposal_revisions%rowtype;
  v_name text := btrim(coalesce(p_name, '')); v_email text := lower(btrim(coalesce(p_email, '')));
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_decision not in ('accepted', 'declined') or char_length(v_name) not between 2 and 120
     or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+$' or char_length(coalesce(v_comment, '')) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;
  select * into l from public.proposal_share_links where token_hash = p_token_hash;
  if not found or l.revoked_at is not null or l.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;

  perform private.prop_expire_one(l.proposal_id);
  select * into prop from public.proposals where id = l.proposal_id for update;   -- serializa decisões concorrentes
  select * into rev from public.proposal_revisions where id = l.revision_id;
  if prop.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if l.revision_id is distinct from prop.published_revision_id then return jsonb_build_object('ok', false, 'error', 'superseded'); end if;
  if exists (select 1 from public.proposal_decisions x where x.revision_id = l.revision_id) or prop.status in ('accepted', 'declined') then
    return jsonb_build_object('ok', false, 'error', 'already_decided');
  end if;
  if prop.status = 'expired' or rev.valid_until < private.prop_today() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if prop.status not in ('sent', 'viewed') then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;

  insert into public.proposal_decisions (organization_id, proposal_id, revision_id, decision, client_name, client_email, comment, link_id)
  values (prop.organization_id, prop.id, rev.id, p_decision::public.proposal_decision_kind, v_name, v_email, v_comment, l.id);
  update public.proposals set status = p_decision::public.proposal_status where id = prop.id;
  insert into public.proposal_events (organization_id, proposal_id, revision_id, event_type, actor_id, metadata)
  values (prop.organization_id, prop.id, rev.id, p_decision, null, jsonb_build_object('link', l.id));
  return jsonb_build_object('ok', true, 'decision', p_decision);
end $$;

-- ======================================================================= privilégios de execução
do $$
declare f text;
begin
  foreach f in array array[
    'public.prop_create_proposal(uuid, text, uuid, uuid)',
    'public.prop_save_draft(uuid, jsonb)',
    'public.prop_publish_revision(uuid)',
    'public.prop_create_revision(uuid)',
    'public.prop_cancel(uuid, text)',
    'public.prop_duplicate(uuid, uuid)',
    'public.prop_create_share_link(uuid, text, timestamptz)',
    'public.prop_revoke_share_link(uuid)',
    'public.prop_expire_overdue(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.prop_public_view(text, boolean)',
    'public.prop_public_decide(text, text, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
comment on function public.prop_public_view(text, boolean) is 'PUBLIC_ENDPOINT: visualização da proposta pelo cliente via token (hash). Resposta uniforme para link inválido. Ver docs/DATABASE.md.';
comment on function public.prop_public_decide(text, text, text, text, text) is 'PUBLIC_ENDPOINT: aceite ou recusa pelo cliente via token (hash), serializado por trava de linha. Ver docs/DATABASE.md.';
revoke all on function private.prop_text_to_doc(text) from public;
revoke all on function private.prop_initial_content(public.proposal_templates, text) from public;

commit;
