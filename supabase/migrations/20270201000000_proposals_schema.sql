-- Gestão de Propostas Comerciais — SCHEMA, CÁLCULO, REGRAS E SEGURANÇA (parte 1)
-- Depende das migrações do Core (organizações, papéis, auditoria, MFA). Arquivo do sistema: pode ser editado.
-- Princípios: toda tabela com organization_id + RLS; dinheiro em centavos (bigint); revisão publicada é imutável;
-- transições de status só por funções (e validadas por gatilho); nada de tabela acessível a anon.
-- A parte 2 (20270201000100) tem as funções do fluxo (publicar, revisar, link público, decisão).

begin;

-- ======================================================================= tipos
create type public.proposal_status as enum ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled');
create type public.catalog_item_type as enum ('product', 'service');
create type public.client_type as enum ('company', 'person');
create type public.discount_kind as enum ('none', 'percent', 'fixed');
create type public.proposal_decision_kind as enum ('accepted', 'declined');

-- ======================================================================= funções de autorização
create function private.prop_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m
  where m.organization_id = org and m.user_id = (select auth.uid());
$$;

-- Leitura: gestão e leitor veem tudo; vendedor só as próprias propostas.
create function private.prop_can_read_owned(org uuid, owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    case private.prop_role(org)
      when 'owner' then true when 'admin' then true when 'manager' then true when 'viewer' then true
      when 'member' then owner is not distinct from (select auth.uid())
      else false end, false);
$$;

-- Escrita: gestão em tudo; vendedor só no que é dele (e não repassa a outra pessoa).
create function private.prop_can_write_owned(org uuid, owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    case private.prop_role(org)
      when 'owner' then true when 'admin' then true when 'manager' then true
      when 'member' then owner is not distinct from (select auth.uid())
      else false end, false);
$$;

-- Data de hoje no fuso de Brasília (validade e alertas são por data, não por instante).
create function private.prop_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

revoke all on function private.prop_role(uuid) from public;
revoke all on function private.prop_can_read_owned(uuid, uuid) from public;
revoke all on function private.prop_can_write_owned(uuid, uuid) from public;
revoke all on function private.prop_today() from public;
grant execute on function private.prop_role(uuid) to authenticated;
grant execute on function private.prop_can_read_owned(uuid, uuid) to authenticated;
grant execute on function private.prop_can_write_owned(uuid, uuid) to authenticated;
grant execute on function private.prop_today() to authenticated;

-- ======================================================================= tabelas
-- Configurações comerciais e dados da empresa (1 linha por organização).
create table public.proposal_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text check (legal_name is null or char_length(legal_name) <= 160),
  document_number text check (document_number is null or char_length(document_number) <= 20),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 30),
  address text check (address is null or char_length(address) <= 300),
  footer_text text check (footer_text is null or char_length(footer_text) <= 400),
  number_prefix text not null default '' check (number_prefix ~ '^[A-Za-z0-9-]{0,10}$'),
  last_number bigint not null default 0 check (last_number >= 0),
  default_validity_days integer not null default 30 check (default_validity_days between 1 and 365),
  default_terms text check (default_terms is null or char_length(default_terms) <= 4000),
  currency text not null default 'BRL' check (currency = 'BRL'),
  primary_color text not null default '#162A43' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#22D3EE' check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Logotipo do documento (PNG ou JPEG, até ~300 KB). Fica no banco para que a revisão publicada
  -- carregue a identidade visual da época (snapshot) e o PDF público não dependa de Storage.
  logo_data_url text check (logo_data_url is null or (
    char_length(logo_data_url) <= 420000 and logo_data_url ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$')),
  max_discount_member_pct numeric(5,2) not null default 10 check (max_discount_member_pct between 0 and 100),
  max_discount_manager_pct numeric(5,2) not null default 30 check (max_discount_manager_pct between 0 and 100),
  alert_expiring_days integer not null default 7 check (alert_expiring_days between 1 and 90),
  alert_no_reply_days integer not null default 5 check (alert_no_reply_days between 1 and 90),
  alert_recent_accept_days integer not null default 7 check (alert_recent_accept_days between 1 and 90),
  custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) <= 8192),
  updated_at timestamptz not null default now()
);

-- Modelos visuais. O conteúdo da proposta é independente do modelo (trocar não apaga dados).
create table public.proposal_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 300),
  base text not null check (base in ('corporate', 'agency', 'technical')),
  structure_json jsonb not null default '{"sections":[]}'::jsonb check (jsonb_typeof(structure_json) = 'object' and pg_column_size(structure_json) <= 8192),
  style_json jsonb not null default '{}'::jsonb check (jsonb_typeof(style_json) = 'object' and pg_column_size(style_json) <= 4096),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index proposal_templates_name_uniq on public.proposal_templates (organization_id, lower(name));
create unique index proposal_templates_one_default on public.proposal_templates (organization_id) where is_default;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type public.client_type not null default 'company',
  name text not null check (char_length(name) between 2 and 160),
  legal_name text check (legal_name is null or char_length(legal_name) <= 160),
  document_number text check (document_number is null or char_length(document_number) between 11 and 14),
  email text check (email is null or (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  phone text check (phone is null or char_length(phone) <= 30),
  address text check (address is null or char_length(address) <= 300),
  notes text check (notes is null or char_length(notes) <= 4000),
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index clients_org_idx on public.clients (organization_id, archived_at, name);
create unique index clients_document_uniq on public.clients (organization_id, document_number)
  where archived_at is null and document_number is not null;

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type public.catalog_item_type not null default 'service',
  name text not null check (char_length(name) between 2 and 160),
  description text check (description is null or char_length(description) <= 2000),
  sku text check (sku is null or char_length(sku) between 1 and 40),
  unit text not null default 'un' check (char_length(unit) between 1 and 20),
  default_price_cents bigint not null default 0 check (default_price_cents between 0 and 99999999999),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index catalog_sku_uniq on public.catalog_items (organization_id, lower(sku)) where sku is not null;
create index catalog_org_idx on public.catalog_items (organization_id, active, name);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  owner_id uuid,
  proposal_number text not null,
  title text not null check (char_length(title) between 2 and 160),
  status public.proposal_status not null default 'draft',
  currency text not null default 'BRL' check (currency = 'BRL'),
  current_revision_id uuid,
  published_revision_id uuid,
  first_sent_at timestamptz,
  archived_at timestamptz,
  custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, proposal_number),
  foreign key (client_id, organization_id) references public.clients (id, organization_id) on delete restrict,
  foreign key (organization_id, owner_id) references public.organization_members (organization_id, user_id) on delete set null (owner_id)
);
create index proposals_org_status_idx on public.proposals (organization_id, status, created_at desc);
create index proposals_owner_idx on public.proposals (organization_id, owner_id);
create index proposals_client_idx on public.proposals (client_id);

create table public.proposal_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  proposal_id uuid not null,
  version_number integer not null check (version_number >= 1),
  template_id uuid,
  content_json jsonb not null default '{"sections":[]}'::jsonb check (jsonb_typeof(content_json) = 'object' and pg_column_size(content_json) <= 262144),
  discount_kind public.discount_kind not null default 'none',
  discount_value numeric(14,4) not null default 0 check (discount_value >= 0),
  charges jsonb not null default '[]'::jsonb check (jsonb_typeof(charges) = 'array' and jsonb_array_length(charges) <= 10),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  items_discount_cents bigint not null default 0 check (items_discount_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  additional_charges_cents bigint not null default 0 check (additional_charges_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  issue_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  valid_until date,
  snapshot_json jsonb check (snapshot_json is null or pg_column_size(snapshot_json) <= 1048576),
  published_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (proposal_id, version_number),
  check ((published_at is null) = (snapshot_json is null)),
  check (valid_until is null or valid_until >= issue_date),
  foreign key (proposal_id, organization_id) references public.proposals (id, organization_id) on delete cascade,
  foreign key (template_id, organization_id) references public.proposal_templates (id, organization_id) on delete set null (template_id)
);
create index proposal_revisions_proposal_idx on public.proposal_revisions (proposal_id, version_number desc);

alter table public.proposals
  add foreign key (current_revision_id, organization_id) references public.proposal_revisions (id, organization_id) on delete set null (current_revision_id),
  add foreign key (published_revision_id, organization_id) references public.proposal_revisions (id, organization_id) on delete set null (published_revision_id);

create table public.proposal_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  revision_id uuid not null,
  catalog_item_id uuid,
  item_type public.catalog_item_type not null default 'service',
  name text not null check (char_length(name) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  unit text not null default 'un' check (char_length(unit) between 1 and 20),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 99999999999),
  discount_kind public.discount_kind not null default 'none',
  discount_value numeric(14,4) not null default 0 check (discount_value >= 0),
  gross_cents bigint not null default 0 check (gross_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (revision_id, position),
  foreign key (revision_id, organization_id) references public.proposal_revisions (id, organization_id) on delete cascade,
  foreign key (catalog_item_id, organization_id) references public.catalog_items (id, organization_id) on delete set null (catalog_item_id)
);
create index proposal_items_revision_idx on public.proposal_items (revision_id, position);

-- Linha do tempo (somente inserção: ninguém recebe UPDATE/DELETE).
create table public.proposal_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  proposal_id uuid not null,
  revision_id uuid,
  event_type text not null check (event_type in (
    'created', 'revised', 'published', 'sent', 'link_created', 'link_revoked', 'viewed',
    'accepted', 'declined', 'expired', 'cancelled', 'email')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  created_at timestamptz not null default now(),
  foreign key (proposal_id, organization_id) references public.proposals (id, organization_id) on delete cascade
);
create index proposal_events_proposal_idx on public.proposal_events (proposal_id, created_at);
create index proposal_events_org_type_idx on public.proposal_events (organization_id, event_type, created_at desc);

create table public.proposal_share_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  proposal_id uuid not null,
  revision_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (proposal_id, organization_id) references public.proposals (id, organization_id) on delete cascade,
  foreign key (revision_id, organization_id) references public.proposal_revisions (id, organization_id) on delete cascade
);
create index proposal_links_proposal_idx on public.proposal_share_links (proposal_id, created_at desc);

create table public.proposal_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  proposal_id uuid not null,
  revision_id uuid not null unique,
  decision public.proposal_decision_kind not null,
  client_name text not null check (char_length(client_name) between 2 and 120),
  client_email text not null check (char_length(client_email) <= 254 and client_email ~ '^[^@\s]+@[^@\s]+$'),
  comment text check (comment is null or char_length(comment) <= 1000),
  link_id uuid references public.proposal_share_links(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (proposal_id, organization_id) references public.proposals (id, organization_id) on delete cascade,
  foreign key (revision_id, organization_id) references public.proposal_revisions (id, organization_id) on delete cascade
);
create index proposal_decisions_org_idx on public.proposal_decisions (organization_id, created_at desc);

create table public.proposal_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  proposal_id uuid not null,
  revision_id uuid,
  recipient_email text not null check (char_length(recipient_email) <= 254 and recipient_email ~ '^[^@\s]+@[^@\s]+$'),
  delivery_status text not null check (delivery_status in ('not_configured', 'sent', 'failed')),
  provider_reference text check (provider_reference is null or char_length(provider_reference) <= 200),
  error_message text check (error_message is null or char_length(error_message) <= 300),
  attempted_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  foreign key (proposal_id, organization_id) references public.proposals (id, organization_id) on delete cascade
);
create index proposal_emails_proposal_idx on public.proposal_email_deliveries (proposal_id, attempted_at desc);

create table public.commercial_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  period_start date not null,
  period_end date not null,
  target_value_cents bigint not null check (target_value_cents > 0 and target_value_cents <= 99999999999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index commercial_goals_idx on public.commercial_goals (organization_id, period_start, period_end);

do $$
declare t text;
begin
  foreach t in array array['proposal_settings','proposal_templates','clients','catalog_items','proposals','proposal_revisions','commercial_goals']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ======================================================================= motor de cálculo (fonte única no banco)
-- Função pura: o mesmo cálculo roda no editor (TypeScript, espelho testado com as mesmas fixtures) e aqui.
-- Ordem e arredondamento: docs/METRICS.md §Precificação. round_half_up(x) = floor(x + 0.5), x >= 0.
create function public.prop_compute(p_items jsonb, p_discount jsonb default '{"kind":"none","value":0}'::jsonb, p_charges jsonb default '[]'::jsonb)
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  it jsonb; ch jsonb;
  qty numeric; price numeric; kind text; val numeric;
  gross numeric; disc numeric; net numeric;
  sum_gross numeric := 0; sum_item_disc numeric := 0; subtotal numeric := 0;
  gkind text; gval numeric; gdisc numeric := 0; base numeric;
  ckind text; cval numeric; camt numeric; sum_charges numeric := 0; total numeric;
  items_out jsonb := '[]'::jsonb; charges_out jsonb := '[]'::jsonb;
begin
  if p_items is null then p_items := '[]'::jsonb; end if;
  if p_charges is null then p_charges := '[]'::jsonb; end if;
  if p_discount is null then p_discount := '{"kind":"none","value":0}'::jsonb; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_typeof(p_charges) <> 'array' or jsonb_typeof(p_discount) <> 'object' then
    raise exception 'dados de cálculo inválidos' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 or jsonb_array_length(p_charges) > 10 then
    raise exception 'itens ou encargos demais' using errcode = '22023';
  end if;

  for it in select value from jsonb_array_elements(p_items) loop
    begin
      qty := (it ->> 'quantity')::numeric;
      price := (it ->> 'unit_price_cents')::numeric;
      kind := coalesce(it ->> 'discount_kind', 'none');
      val := coalesce((it ->> 'discount_value')::numeric, 0);
    exception when others then
      raise exception 'item com número inválido' using errcode = '22023';
    end;
    if qty is null or qty <= 0 or qty > 99999999 or qty <> round(qty, 4) then
      raise exception 'quantidade inválida' using errcode = '22023';
    end if;
    if price is null or price < 0 or price > 99999999999 or price <> floor(price) then
      raise exception 'preço inválido' using errcode = '22023';
    end if;
    gross := floor(qty * price + 0.5);
    if kind = 'none' then
      disc := 0;
    elsif kind = 'percent' then
      if val < 0 or val > 100 or val <> round(val, 2) then raise exception 'desconto percentual inválido' using errcode = '22023'; end if;
      disc := floor(gross * val / 100 + 0.5);
    elsif kind = 'fixed' then
      if val < 0 or val <> floor(val) then raise exception 'desconto fixo inválido' using errcode = '22023'; end if;
      disc := floor(val);
    else
      raise exception 'tipo de desconto inválido' using errcode = '22023';
    end if;
    disc := least(disc, gross);
    net := gross - disc;
    sum_gross := sum_gross + gross; sum_item_disc := sum_item_disc + disc; subtotal := subtotal + net;
    items_out := items_out || jsonb_build_object('gross_cents', gross, 'discount_cents', disc, 'total_cents', net);
  end loop;

  gkind := coalesce(p_discount ->> 'kind', 'none');
  begin gval := coalesce((p_discount ->> 'value')::numeric, 0); exception when others then
    raise exception 'desconto global inválido' using errcode = '22023';
  end;
  if gkind = 'percent' then
    if gval < 0 or gval > 100 or gval <> round(gval, 2) then raise exception 'desconto global inválido' using errcode = '22023'; end if;
    gdisc := floor(subtotal * gval / 100 + 0.5);
  elsif gkind = 'fixed' then
    if gval < 0 or gval <> floor(gval) then raise exception 'desconto global inválido' using errcode = '22023'; end if;
    gdisc := floor(gval);
  elsif gkind <> 'none' then
    raise exception 'tipo de desconto global inválido' using errcode = '22023';
  end if;
  gdisc := least(gdisc, subtotal);
  base := subtotal - gdisc;

  for ch in select value from jsonb_array_elements(p_charges) loop
    ckind := ch ->> 'kind';
    begin cval := (ch ->> 'value')::numeric; exception when others then
      raise exception 'encargo inválido' using errcode = '22023';
    end;
    if coalesce(char_length(btrim(ch ->> 'label')), 0) not between 1 and 60 or cval is null or cval < 0 then
      raise exception 'encargo inválido' using errcode = '22023';
    end if;
    if ckind = 'percent' then
      if cval > 100 or cval <> round(cval, 2) then raise exception 'encargo inválido' using errcode = '22023'; end if;
      camt := floor(base * cval / 100 + 0.5);
    elsif ckind = 'fixed' then
      if cval <> floor(cval) or cval > 99999999999 then raise exception 'encargo inválido' using errcode = '22023'; end if;
      camt := floor(cval);
    else
      raise exception 'encargo inválido' using errcode = '22023';
    end if;
    sum_charges := sum_charges + camt;
    charges_out := charges_out || jsonb_build_object('label', btrim(ch ->> 'label'), 'kind', ckind, 'value', cval, 'amount_cents', camt);
  end loop;

  total := base + sum_charges;
  if total > 99999999999 then raise exception 'valor total acima do limite' using errcode = '22023'; end if;
  return jsonb_build_object(
    'items', items_out, 'gross_cents', sum_gross, 'items_discount_cents', sum_item_disc,
    'subtotal_cents', subtotal, 'discount_cents', gdisc, 'base_cents', base,
    'charges', charges_out, 'additional_charges_cents', sum_charges, 'total_cents', total);
end $$;
revoke all on function public.prop_compute(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.prop_compute(jsonb, jsonb, jsonb) to authenticated;

-- ======================================================================= regras em gatilhos
-- Um único modelo padrão por organização: marcar um desmarca o outro; o padrão não pode ficar sem modelo.
create function private.prop_template_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_default and not old.is_default then
    update public.proposal_templates set is_default = false where organization_id = new.organization_id and id <> new.id and is_default;
  elsif old.is_default and not new.is_default and pg_trigger_depth() = 1 then
    raise exception 'escolha outro modelo como padrão em vez de desmarcar este' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.prop_template_default() from public;
create trigger proposal_templates_default before update of is_default on public.proposal_templates
  for each row execute function private.prop_template_default();

-- Documento (CPF/CNPJ) guardado só com dígitos; e-mail normalizado.
create function private.prop_normalize_client() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  new.document_number := nullif(regexp_replace(coalesce(new.document_number, ''), '\D', '', 'g'), '');
  return new;
end $$;
create trigger clients_normalize before insert or update on public.clients
  for each row execute function private.prop_normalize_client();

-- Numeração sequencial por organização, sem buracos nem repetição (linha de configuração travada).
create function private.prop_set_number() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.proposal_settings%rowtype;
begin
  update public.proposal_settings set last_number = last_number + 1
  where organization_id = new.organization_id returning * into s;
  if not found then
    raise exception 'configuração da organização ausente' using errcode = 'P0002';
  end if;
  new.proposal_number := s.number_prefix || lpad(s.last_number::text, 5, '0');
  return new;
end $$;
revoke all on function private.prop_set_number() from public;
create trigger proposals_number before insert on public.proposals
  for each row execute function private.prop_set_number();

-- Máquina de estados (defesa em profundidade: vale também para as funções do fluxo).
create function private.prop_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'draft'    and new.status in ('sent', 'cancelled')) or
    (old.status = 'sent'     and new.status in ('viewed', 'accepted', 'declined', 'expired', 'cancelled', 'sent')) or
    (old.status = 'viewed'   and new.status in ('accepted', 'declined', 'expired', 'cancelled', 'sent')) or
    (old.status = 'expired'  and new.status in ('sent', 'cancelled')) or
    (old.status = 'declined' and new.status in ('sent', 'cancelled'))
  ) then
    raise exception 'transição de status não permitida: % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;
create trigger proposals_status_guard before update of status on public.proposals
  for each row execute function private.prop_status_guard();

-- Revisão publicada é imutável (inclusive para as funções do fluxo).
create function private.prop_revision_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.published_at is not null then
    raise exception 'revisão publicada é imutável' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger proposal_revisions_immutable before update on public.proposal_revisions
  for each row execute function private.prop_revision_immutable();

-- Itens de revisão publicada também não mudam (nem entram, nem saem). Se a revisão-pai já foi removida
-- (exclusão em cascata da organização), a verificação passa.
create function private.prop_items_immutable() returns trigger
language plpgsql set search_path = '' as $$
declare rid uuid := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
begin
  if exists (select 1 from public.proposal_revisions r where r.id = rid and r.published_at is not null) then
    raise exception 'itens de revisão publicada são imutáveis' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger proposal_items_immutable before insert or update or delete on public.proposal_items
  for each row execute function private.prop_items_immutable();

-- ======================================================================= padrões por organização
create function private.prop_bootstrap_org(org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.proposal_settings (organization_id) values (org) on conflict do nothing;
  if not exists (select 1 from public.proposal_templates where organization_id = org) then
    insert into public.proposal_templates (organization_id, name, description, base, structure_json, is_default) values
      (org, 'Corporativo', 'Aparência sóbria e minimalista, indicada para consultorias, empresas B2B e tecnologia.', 'corporate',
       '{"sections":[{"kind":"presentation","title":"Apresentação","enabled":true},{"kind":"objective","title":"Objetivo","enabled":true},{"kind":"scope","title":"Escopo","enabled":true},{"kind":"deliverables","title":"Entregáveis","enabled":true},{"kind":"timeline","title":"Cronograma","enabled":false},{"kind":"terms","title":"Condições comerciais","enabled":true},{"kind":"closing","title":"Considerações finais","enabled":true}]}', true),
      (org, 'Agência Criativa', 'Destaque para apresentação, escopo, entregáveis e cronograma. Indicada para agências e serviços criativos.', 'agency',
       '{"sections":[{"kind":"presentation","title":"Quem somos","enabled":true},{"kind":"objective","title":"O desafio","enabled":true},{"kind":"scope","title":"Nossa proposta","enabled":true},{"kind":"deliverables","title":"Entregáveis","enabled":true},{"kind":"timeline","title":"Cronograma","enabled":true},{"kind":"terms","title":"Condições comerciais","enabled":true},{"kind":"closing","title":"Próximos passos","enabled":true}]}', false),
      (org, 'Serviços Técnicos', 'Foco em descrição dos serviços, quantidades, preços e condições. Indicada para manutenção, assistência e instalações.', 'technical',
       '{"sections":[{"kind":"scope","title":"Descrição dos serviços","enabled":true},{"kind":"deliverables","title":"Materiais e entregas","enabled":false},{"kind":"timeline","title":"Prazo de execução","enabled":true},{"kind":"terms","title":"Condições comerciais","enabled":true},{"kind":"closing","title":"Observações","enabled":false}]}', false);
  end if;
end $$;
revoke all on function private.prop_bootstrap_org(uuid) from public;

create function private.prop_on_org_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.prop_bootstrap_org(new.id);
  return null;
end $$;
revoke all on function private.prop_on_org_created() from public;
create trigger prop_on_org_created after insert on public.organizations
  for each row execute function private.prop_on_org_created();

select private.prop_bootstrap_org(id) from public.organizations;

-- Auditoria (somente metadados) das entidades de negócio.
do $$
declare t text;
begin
  foreach t in array array['clients','catalog_items','proposals','commercial_goals']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)', 'audit_' || t, t, 'organization_id', 'id');
  end loop;
  create trigger audit_proposal_templates after update or delete on public.proposal_templates for each row execute function private.audit_trigger('organization_id', 'id');
  create trigger audit_proposal_settings after update on public.proposal_settings for each row execute function private.audit_trigger('organization_id', 'organization_id');
end $$;

-- ======================================================================= RLS
do $$
declare t text;
begin
  foreach t in array array['proposal_settings','proposal_templates','clients','catalog_items','proposals','proposal_revisions','proposal_items',
                           'proposal_events','proposal_share_links','proposal_decisions','proposal_email_deliveries','commercial_goals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Configuração e catálogo: todos os membros leem.
create policy proposal_settings_select on public.proposal_settings for select to authenticated using (private.is_member(organization_id));
create policy proposal_settings_update on public.proposal_settings for update to authenticated
  using (private.has_role(organization_id, array['owner','admin']::public.org_role[]))
  with check (private.has_role(organization_id, array['owner','admin']::public.org_role[]));

create policy proposal_templates_select on public.proposal_templates for select to authenticated using (private.is_member(organization_id));
create policy proposal_templates_update on public.proposal_templates for update to authenticated
  using (private.has_role(organization_id, array['owner','admin']::public.org_role[]))
  with check (private.has_role(organization_id, array['owner','admin']::public.org_role[]));

create policy catalog_items_select on public.catalog_items for select to authenticated using (private.is_member(organization_id));
create policy catalog_items_insert on public.catalog_items for insert to authenticated
  with check (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]));
create policy catalog_items_update on public.catalog_items for update to authenticated
  using (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]))
  with check (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]));

-- Clientes: todos leem; todos exceto leitor cadastram e editam; não há exclusão (arquiva-se).
create policy clients_select on public.clients for select to authenticated using (private.is_member(organization_id));
create policy clients_insert on public.clients for insert to authenticated
  with check (private.has_role(organization_id, array['owner','admin','manager','member']::public.org_role[]));
create policy clients_update on public.clients for update to authenticated
  using (private.has_role(organization_id, array['owner','admin','manager','member']::public.org_role[]))
  with check (private.has_role(organization_id, array['owner','admin','manager','member']::public.org_role[]));

-- Propostas: leitura por papel/responsável; criação, revisão, status e publicação só pelas funções.
create policy proposals_select on public.proposals for select to authenticated using (private.prop_can_read_owned(organization_id, owner_id));
create policy proposals_update on public.proposals for update to authenticated
  using (private.prop_can_write_owned(organization_id, owner_id))
  with check (private.prop_can_write_owned(organization_id, owner_id));

-- Tabelas filhas: enxerga quem enxerga a proposta (o RLS dela se aplica na subconsulta).
do $$
declare t text;
begin
  foreach t in array array['proposal_revisions','proposal_events','proposal_share_links','proposal_decisions','proposal_email_deliveries']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.proposals p where p.id = proposal_id))', t || '_select', t);
  end loop;
end $$;
create policy proposal_items_select on public.proposal_items for select to authenticated
  using (exists (select 1 from public.proposal_revisions r where r.id = revision_id));

-- Registro de tentativa de e-mail: quem pode editar a proposta registra.
create policy proposal_emails_insert on public.proposal_email_deliveries for insert to authenticated
  with check (exists (select 1 from public.proposals p where p.id = proposal_id and private.prop_can_write_owned(p.organization_id, p.owner_id)));

-- Metas: gestão e leitor veem todas; vendedor, a própria; gestão escreve.
create policy commercial_goals_select on public.commercial_goals for select to authenticated
  using (private.has_role(organization_id, array['owner','admin','manager','viewer']::public.org_role[]) or user_id = (select auth.uid()));
create policy commercial_goals_insert on public.commercial_goals for insert to authenticated
  with check (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]));
create policy commercial_goals_update on public.commercial_goals for update to authenticated
  using (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]))
  with check (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]));
create policy commercial_goals_delete on public.commercial_goals for delete to authenticated
  using (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]));

-- MFA no banco (padrão do Core): escrita de owner/admin exige AAL2.
do $$
declare t text;
begin
  foreach t in array array['proposal_settings','proposal_templates','clients','catalog_items','proposals','proposal_email_deliveries','commercial_goals']
  loop
    execute format('create policy mfa_insert on public.%I as restrictive for insert to authenticated with check (private.mfa_ok())', t);
    execute format('create policy mfa_update on public.%I as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok())', t);
    execute format('create policy mfa_delete on public.%I as restrictive for delete to authenticated using (private.mfa_ok())', t);
  end loop;
end $$;

-- Privilégios por coluna: sem status, número, revisões, datas de envio, created_by nem organization_id em UPDATE.
grant update (legal_name, document_number, email, phone, address, footer_text, number_prefix, default_validity_days, default_terms,
              primary_color, secondary_color, logo_data_url, max_discount_member_pct, max_discount_manager_pct,
              alert_expiring_days, alert_no_reply_days, alert_recent_accept_days, custom)
  on public.proposal_settings to authenticated;
grant update (name, description, structure_json, style_json, is_default) on public.proposal_templates to authenticated;
grant insert (organization_id, type, name, legal_name, document_number, email, phone, address, notes, custom) on public.clients to authenticated;
grant update (type, name, legal_name, document_number, email, phone, address, notes, archived_at, custom) on public.clients to authenticated;
grant insert (organization_id, type, name, description, sku, unit, default_price_cents, active, custom) on public.catalog_items to authenticated;
grant update (type, name, description, sku, unit, default_price_cents, active, custom) on public.catalog_items to authenticated;
grant update (owner_id, archived_at, custom) on public.proposals to authenticated;
grant insert (organization_id, proposal_id, revision_id, recipient_email, delivery_status, provider_reference, error_message)
  on public.proposal_email_deliveries to authenticated;
grant insert (organization_id, user_id, period_start, period_end, target_value_cents) on public.commercial_goals to authenticated;
grant update (period_start, period_end, target_value_cents) on public.commercial_goals to authenticated;
grant delete on public.commercial_goals to authenticated;

commit;
