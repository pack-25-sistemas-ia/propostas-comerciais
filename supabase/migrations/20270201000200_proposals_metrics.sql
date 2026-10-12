-- Gestão de Propostas Comerciais — INDICADORES (parte 3). Fonte única dos números do painel e dos relatórios.
-- Definições, datas e exclusões: docs/METRICS.md. Funções security INVOKER: o RLS já limita o que cada papel enxerga
-- (vendedor só as próprias propostas). p_org restringe à organização ativa. Propostas arquivadas ficam de fora.

begin;

create function private.prop_ts(p_date date, p_end boolean default false) returns timestamptz
language sql immutable set search_path = '' as $$
  select ((case when p_end then p_date + 1 else p_date end)::timestamp at time zone 'America/Sao_Paulo');
$$;
revoke all on function private.prop_ts(date, boolean) from public;
grant execute on function private.prop_ts(date, boolean) to authenticated;

-- Propostas dentro dos filtros globais (vendedor, cliente, status atual, tipo de item da revisão vigente).
create function private.prop_scope(p_org uuid, p_owner uuid, p_client uuid, p_status public.proposal_status, p_type public.catalog_item_type)
returns setof public.proposals
language sql stable security invoker set search_path = '' as $$
  select p.* from public.proposals p
  where p.organization_id = p_org and p.archived_at is null
    and (p_owner is null or p.owner_id = p_owner)
    and (p_client is null or p.client_id = p_client)
    and (p_status is null or p.status = p_status)
    and (p_type is null or exists (
      select 1 from public.proposal_items i
      where i.revision_id = coalesce(p.published_revision_id, p.current_revision_id) and i.item_type = p_type));
$$;
revoke all on function private.prop_scope(uuid, uuid, uuid, public.proposal_status, public.catalog_item_type) from public;
grant execute on function private.prop_scope(uuid, uuid, uuid, public.proposal_status, public.catalog_item_type) to authenticated;

create function private.prop_check_period(p_org uuid, p_from date, p_to date) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_org is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'período inválido' using errcode = '22023';
  end if;
end $$;
revoke all on function private.prop_check_period(uuid, date, date) from public;
grant execute on function private.prop_check_period(uuid, date, date) to authenticated;

-- ======================================================================= indicadores
create function public.prop_kpis(p_org uuid, p_from date, p_to date, p_owner uuid default null, p_client uuid default null,
                                 p_status public.proposal_status default null, p_type public.catalog_item_type default null)
returns table (created_count bigint, sent_count bigint, accepted_count bigint, declined_count bigint, accepted_cents bigint,
               pipeline_cents bigint, pipeline_count bigint, acceptance_rate numeric, avg_ticket_cents bigint, avg_days_to_decision numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare t0 timestamptz; t1 timestamptz; v_today date := private.prop_today();
begin
  perform private.prop_check_period(p_org, p_from, p_to);
  t0 := private.prop_ts(p_from); t1 := private.prop_ts(p_to, true);
  return query
  with s as (select * from private.prop_scope(p_org, p_owner, p_client, p_status, p_type)),
  dec as (
    select d.decision, d.created_at as decided_at, r.total_cents, s.first_sent_at
    from public.proposal_decisions d join s on s.id = d.proposal_id join public.proposal_revisions r on r.id = d.revision_id
    where d.created_at >= t0 and d.created_at < t1
  ), agg as (
    select
      count(*) filter (where decision = 'accepted') as ac,
      count(*) filter (where decision = 'declined') as dc,
      coalesce(sum(total_cents) filter (where decision = 'accepted'), 0) as av,
      avg(extract(epoch from (decided_at - first_sent_at)) / 86400.0) filter (where first_sent_at is not null) as days
    from dec
  ), pipe as (
    select count(*) as pc, coalesce(sum(r.total_cents), 0) as pv
    from s join public.proposal_revisions r on r.id = s.published_revision_id
    where s.status in ('sent', 'viewed') and r.valid_until >= v_today
  )
  select
    (select count(*) from s where s.created_at >= t0 and s.created_at < t1),
    (select count(*) from s where s.first_sent_at >= t0 and s.first_sent_at < t1),
    agg.ac, agg.dc, agg.av::bigint, pipe.pv::bigint, pipe.pc,
    case when agg.ac + agg.dc = 0 then null else round(100.0 * agg.ac / (agg.ac + agg.dc), 2) end,
    case when agg.ac = 0 then null else floor(agg.av::numeric / agg.ac + 0.5)::bigint end,
    case when agg.days is null then null else round(agg.days::numeric, 2) end
  from agg, pipe;
end $$;

-- Série temporal: semana (período <= 90 dias) ou mês.
create function public.prop_series(p_org uuid, p_from date, p_to date, p_owner uuid default null, p_client uuid default null,
                                   p_status public.proposal_status default null, p_type public.catalog_item_type default null)
returns table (bucket date, created_count bigint, sent_count bigint, proposed_cents bigint, accepted_count bigint, declined_count bigint,
               accepted_cents bigint, acceptance_rate numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare t0 timestamptz; t1 timestamptz; unit text;
begin
  perform private.prop_check_period(p_org, p_from, p_to);
  t0 := private.prop_ts(p_from); t1 := private.prop_ts(p_to, true);
  unit := case when p_to - p_from <= 90 then 'week' else 'month' end;
  return query
  with b as (
    select d::date as bk from generate_series(date_trunc(unit, p_from::timestamp), p_to::timestamp,
      case when unit = 'week' then interval '1 week' else interval '1 month' end) d
  ), s as (select * from private.prop_scope(p_org, p_owner, p_client, p_status, p_type)),
  created as (
    select date_trunc(unit, s.created_at at time zone 'America/Sao_Paulo')::date as bk, count(*) as n
    from s where s.created_at >= t0 and s.created_at < t1 group by 1
  ), sent as (
    select date_trunc(unit, s.first_sent_at at time zone 'America/Sao_Paulo')::date as bk, count(*) as n, coalesce(sum(r.total_cents), 0) as v
    from s
    join public.proposal_events e on e.proposal_id = s.id and e.event_type = 'sent'
    join public.proposal_revisions r on r.id = e.revision_id
    where s.first_sent_at >= t0 and s.first_sent_at < t1 group by 1
  ), dec as (
    select date_trunc(unit, d.created_at at time zone 'America/Sao_Paulo')::date as bk,
           count(*) filter (where d.decision = 'accepted') as ac, count(*) filter (where d.decision = 'declined') as dc,
           coalesce(sum(r.total_cents) filter (where d.decision = 'accepted'), 0) as av
    from public.proposal_decisions d join s on s.id = d.proposal_id join public.proposal_revisions r on r.id = d.revision_id
    where d.created_at >= t0 and d.created_at < t1 group by 1
  )
  select b.bk, coalesce(created.n, 0), coalesce(sent.n, 0), coalesce(sent.v, 0)::bigint, coalesce(dec.ac, 0), coalesce(dec.dc, 0),
         coalesce(dec.av, 0)::bigint,
         case when coalesce(dec.ac, 0) + coalesce(dec.dc, 0) = 0 then null else round(100.0 * dec.ac / (dec.ac + dec.dc), 2) end
  from b left join created on created.bk = b.bk left join sent on sent.bk = b.bk left join dec on dec.bk = b.bk
  order by b.bk;
end $$;

-- Distribuição por status atual das propostas criadas no período.
create function public.prop_status_distribution(p_org uuid, p_from date, p_to date, p_owner uuid default null, p_client uuid default null,
                                                p_type public.catalog_item_type default null)
returns table (status public.proposal_status, proposal_count bigint, total_cents bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare t0 timestamptz; t1 timestamptz;
begin
  perform private.prop_check_period(p_org, p_from, p_to);
  t0 := private.prop_ts(p_from); t1 := private.prop_ts(p_to, true);
  return query
  select s.status, count(*), coalesce(sum(r.total_cents), 0)::bigint
  from private.prop_scope(p_org, p_owner, p_client, null, p_type) s
  left join public.proposal_revisions r on r.id = coalesce(s.published_revision_id, s.current_revision_id)
  where s.created_at >= t0 and s.created_at < t1
  group by s.status
  order by array_position(array['draft','sent','viewed','accepted','declined','expired','cancelled'], s.status::text);
end $$;

-- Desempenho por vendedor.
create function public.prop_rep_performance(p_org uuid, p_from date, p_to date, p_owner uuid default null, p_client uuid default null,
                                            p_status public.proposal_status default null, p_type public.catalog_item_type default null)
returns table (owner_id uuid, sent_count bigint, accepted_count bigint, declined_count bigint, accepted_cents bigint, acceptance_rate numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare t0 timestamptz; t1 timestamptz;
begin
  perform private.prop_check_period(p_org, p_from, p_to);
  t0 := private.prop_ts(p_from); t1 := private.prop_ts(p_to, true);
  return query
  with s as (select * from private.prop_scope(p_org, p_owner, p_client, p_status, p_type)),
  sent as (select s.owner_id, count(*) as n from s where s.first_sent_at >= t0 and s.first_sent_at < t1 group by s.owner_id),
  dec as (
    select s.owner_id, count(*) filter (where d.decision = 'accepted') as ac, count(*) filter (where d.decision = 'declined') as dc,
           coalesce(sum(r.total_cents) filter (where d.decision = 'accepted'), 0) as av
    from public.proposal_decisions d join s on s.id = d.proposal_id join public.proposal_revisions r on r.id = d.revision_id
    where d.created_at >= t0 and d.created_at < t1 group by s.owner_id
  ), owners as (select sent.owner_id from sent union select dec.owner_id from dec)
  select o.owner_id, coalesce(sent.n, 0), coalesce(dec.ac, 0), coalesce(dec.dc, 0), coalesce(dec.av, 0)::bigint,
         case when coalesce(dec.ac, 0) + coalesce(dec.dc, 0) = 0 then null else round(100.0 * dec.ac / (dec.ac + dec.dc), 2) end
  from owners o left join sent on sent.owner_id is not distinct from o.owner_id left join dec on dec.owner_id is not distinct from o.owner_id
  order by coalesce(dec.av, 0) desc, coalesce(dec.ac, 0) desc, o.owner_id;
end $$;

-- Ranking de clientes por valor aceito.
create function public.prop_client_ranking(p_org uuid, p_from date, p_to date, p_owner uuid default null, p_status public.proposal_status default null,
                                           p_type public.catalog_item_type default null, p_limit integer default 10)
returns table (client_id uuid, client_name text, accepted_count bigint, accepted_cents bigint, proposed_cents bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare t0 timestamptz; t1 timestamptz;
begin
  perform private.prop_check_period(p_org, p_from, p_to);
  t0 := private.prop_ts(p_from); t1 := private.prop_ts(p_to, true);
  return query
  with s as (select * from private.prop_scope(p_org, p_owner, null, p_status, p_type)),
  dec as (
    select s.client_id, count(*) as n, coalesce(sum(r.total_cents), 0) as v
    from public.proposal_decisions d join s on s.id = d.proposal_id join public.proposal_revisions r on r.id = d.revision_id
    where d.decision = 'accepted' and d.created_at >= t0 and d.created_at < t1 group by s.client_id
  ), prop as (
    select s.client_id, coalesce(sum(r.total_cents), 0) as v
    from s join public.proposal_events e on e.proposal_id = s.id and e.event_type = 'sent'
    join public.proposal_revisions r on r.id = e.revision_id
    where s.first_sent_at >= t0 and s.first_sent_at < t1 group by s.client_id
  )
  select c.id, c.name, coalesce(dec.n, 0), coalesce(dec.v, 0)::bigint, coalesce(prop.v, 0)::bigint
  from public.clients c left join dec on dec.client_id = c.id left join prop on prop.client_id = c.id
  where c.organization_id = p_org and coalesce(dec.n, 0) > 0
  order by coalesce(dec.v, 0) desc, c.name
  limit greatest(1, least(coalesce(p_limit, 10), 100));
end $$;

-- Alertas (limites em proposal_settings). days: dias até vencer, dias de atraso, dias sem retorno ou dias desde o aceite.
create function public.prop_alerts(p_org uuid, p_owner uuid default null)
returns table (kind text, proposal_id uuid, proposal_number text, title text, client_name text, owner_id uuid, days integer, total_cents bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare v_today date := private.prop_today(); s public.proposal_settings%rowtype;
begin
  if p_org is null then raise exception 'organização obrigatória' using errcode = '22023'; end if;
  select * into s from public.proposal_settings where organization_id = p_org;
  return query
  select 'expiring', p.id, p.proposal_number, p.title, c.name, p.owner_id, (r.valid_until - v_today), r.total_cents
  from public.proposals p join public.clients c on c.id = p.client_id join public.proposal_revisions r on r.id = p.published_revision_id
  where p.organization_id = p_org and p.archived_at is null and p.status in ('sent', 'viewed')
    and r.valid_until >= v_today and r.valid_until <= v_today + coalesce(s.alert_expiring_days, 7)
    and (p_owner is null or p.owner_id = p_owner)
  union all
  select 'overdue', p.id, p.proposal_number, p.title, c.name, p.owner_id, (v_today - r.valid_until), r.total_cents
  from public.proposals p join public.clients c on c.id = p.client_id join public.proposal_revisions r on r.id = p.published_revision_id
  where p.organization_id = p_org and p.archived_at is null and r.valid_until < v_today
    and (p.status = 'expired' or p.status in ('sent', 'viewed'))
    and (p_owner is null or p.owner_id = p_owner)
  union all
  select 'no_reply', p.id, p.proposal_number, p.title, c.name, p.owner_id,
         floor(extract(epoch from (now() - p.first_sent_at)) / 86400)::integer, r.total_cents
  from public.proposals p join public.clients c on c.id = p.client_id join public.proposal_revisions r on r.id = p.published_revision_id
  where p.organization_id = p_org and p.archived_at is null and p.status in ('sent', 'viewed') and r.valid_until >= v_today
    and p.first_sent_at < now() - (coalesce(s.alert_no_reply_days, 5) * interval '1 day')
    and (p_owner is null or p.owner_id = p_owner)
  union all
  select 'recent_accept', p.id, p.proposal_number, p.title, c.name, p.owner_id,
         floor(extract(epoch from (now() - d.created_at)) / 86400)::integer, r.total_cents
  from public.proposal_decisions d
  join public.proposals p on p.id = d.proposal_id join public.clients c on c.id = p.client_id join public.proposal_revisions r on r.id = d.revision_id
  where p.organization_id = p_org and p.archived_at is null and d.decision = 'accepted'
    and d.created_at >= now() - (coalesce(s.alert_recent_accept_days, 7) * interval '1 day')
    and (p_owner is null or p.owner_id = p_owner);
end $$;

-- Metas: realizado = valor aceito (decisão dentro do período da meta) das propostas do responsável.
create function public.prop_goals_progress(p_org uuid, p_owner uuid default null)
returns table (goal_id uuid, user_id uuid, period_start date, period_end date, target_cents bigint, achieved_cents bigint, pct numeric, elapsed_pct numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare v_today date := private.prop_today();
begin
  if p_org is null then raise exception 'organização obrigatória' using errcode = '22023'; end if;
  return query
  select g.id, g.user_id, g.period_start, g.period_end, g.target_value_cents,
         coalesce(a.v, 0)::bigint,
         round(100.0 * coalesce(a.v, 0) / g.target_value_cents, 2),
         round(100.0 * greatest(0, least(v_today - g.period_start + 1, g.period_end - g.period_start + 1)) / (g.period_end - g.period_start + 1), 2)
  from public.commercial_goals g
  left join lateral (
    select sum(r.total_cents) as v
    from public.proposal_decisions d
    join public.proposals p on p.id = d.proposal_id and p.owner_id = g.user_id and p.organization_id = g.organization_id
    join public.proposal_revisions r on r.id = d.revision_id
    where d.decision = 'accepted' and d.created_at >= private.prop_ts(g.period_start) and d.created_at < private.prop_ts(g.period_end, true)
  ) a on true
  where g.organization_id = p_org and (p_owner is null or g.user_id = p_owner)
  order by g.period_start desc, g.user_id;
end $$;

-- Nomes exibidos nos responsáveis e rankings. Expõe só o nome (ou parte local do e-mail) a membros da própria organização.
create function public.prop_user_labels(p_org uuid) returns table (user_id uuid, label text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(nullif(p.full_name, ''), nullif(split_part(p.email, '@', 1), ''), 'Usuário')
  from public.organization_members m
  left join public.profiles p on p.id = m.user_id
  where m.organization_id = p_org and private.is_member(p_org);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.prop_kpis(uuid, date, date, uuid, uuid, public.proposal_status, public.catalog_item_type)',
    'public.prop_series(uuid, date, date, uuid, uuid, public.proposal_status, public.catalog_item_type)',
    'public.prop_status_distribution(uuid, date, date, uuid, uuid, public.catalog_item_type)',
    'public.prop_rep_performance(uuid, date, date, uuid, uuid, public.proposal_status, public.catalog_item_type)',
    'public.prop_client_ranking(uuid, date, date, uuid, public.proposal_status, public.catalog_item_type, integer)',
    'public.prop_alerts(uuid, uuid)',
    'public.prop_goals_progress(uuid, uuid)',
    'public.prop_user_labels(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
