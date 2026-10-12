import 'server-only';
import type { Context } from '@/lib/auth/session';
import { sanitizeContent, type ProposalContent } from './content';
import type { ProposalStatus } from './filters';

// ------------------------------------------------------------------ tipos das linhas
export type Person = { user_id: string; label: string };
export type TemplateRow = { id: string; name: string; description: string | null; base: 'corporate' | 'agency' | 'technical'; is_default: boolean; style_json: Record<string, unknown>; structure_json: { sections?: Array<{ kind: string; title: string; enabled?: boolean }> } };
export type SettingsRow = {
  organization_id: string; legal_name: string | null; document_number: string | null; email: string | null; phone: string | null; address: string | null;
  footer_text: string | null; number_prefix: string; default_validity_days: number; default_terms: string | null; primary_color: string; secondary_color: string;
  logo_data_url: string | null; max_discount_member_pct: number; max_discount_manager_pct: number; alert_expiring_days: number; alert_no_reply_days: number;
  alert_recent_accept_days: number;
};
export type ClientRow = {
  id: string; type: 'company' | 'person'; name: string; legal_name: string | null; document_number: string | null; email: string | null; phone: string | null;
  address: string | null; notes: string | null; archived_at: string | null; created_at: string;
};
export type CatalogRow = {
  id: string; type: 'product' | 'service'; name: string; description: string | null; sku: string | null; unit: string; default_price_cents: number; active: boolean; updated_at: string;
};
export type ProposalRow = {
  id: string; client_id: string; owner_id: string | null; proposal_number: string; title: string; status: ProposalStatus; current_revision_id: string | null;
  published_revision_id: string | null; first_sent_at: string | null; archived_at: string | null; created_at: string; updated_at: string;
};
export type RevisionRow = {
  id: string; proposal_id: string; version_number: number; template_id: string | null; content_json: unknown; discount_kind: 'none' | 'percent' | 'fixed'; discount_value: number;
  charges: Array<{ label: string; kind: 'percent' | 'fixed'; value: number | string }>; subtotal_cents: number; items_discount_cents: number; discount_cents: number;
  additional_charges_cents: number; total_cents: number; issue_date: string; valid_until: string | null; published_at: string | null; created_by: string | null; created_at: string;
  snapshot_json?: unknown;
};
export type ItemRow = {
  id: string; revision_id: string; catalog_item_id: string | null; item_type: 'product' | 'service'; name: string; description: string | null; unit: string; quantity: number | string;
  unit_price_cents: number; discount_kind: 'none' | 'percent' | 'fixed'; discount_value: number | string; gross_cents: number; discount_cents: number; total_cents: number; position: number;
};
export type EventRow = { id: number; proposal_id: string; revision_id: string | null; event_type: string; actor_id: string | null; metadata: Record<string, unknown>; created_at: string };
export type LinkRow = { id: string; revision_id: string; expires_at: string; revoked_at: string | null; created_at: string };
export type DecisionRow = { id: string; revision_id: string; decision: 'accepted' | 'declined'; client_name: string; client_email: string; comment: string | null; created_at: string };
export type EmailRow = { id: string; recipient_email: string; delivery_status: 'not_configured' | 'sent' | 'failed'; error_message: string | null; attempted_at: string };
export type GoalRow = { id: string; user_id: string; period_start: string; period_end: string; target_value_cents: number };

export const PAGE_SIZE = 20;

export function parsePage(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/**
 * Termo de busca seguro para filtros PostgREST: só letras, números, espaço e . _ - @.
 * Remove vírgula, parênteses, asteriscos e aspas (que permitiriam injetar filtros).
 */
export function searchToken(q: string | string[] | undefined): string {
  const v = (Array.isArray(q) ? q[0] : q) ?? '';
  return v.normalize('NFC').replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 60);
}

export const labelMap = (people: Person[]) => new Map(people.map((p) => [p.user_id, p.label]));
export const personOptions = (people: Person[]) => people.map((p) => ({ value: p.user_id, label: p.label }));

// ------------------------------------------------------------------ opções e configuração
export async function loadPeople(ctx: Context): Promise<Person[]> {
  const { data } = await ctx.supabase.rpc('prop_user_labels', { p_org: ctx.membership.organization_id });
  return ((data ?? []) as Person[]).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

export async function loadTemplates(ctx: Context): Promise<TemplateRow[]> {
  const { data } = await ctx.supabase
    .from('proposal_templates')
    .select('id, name, description, base, is_default, style_json, structure_json')
    .eq('organization_id', ctx.membership.organization_id)
    .order('created_at');
  return (data ?? []) as TemplateRow[];
}

export async function loadSettings(ctx: Context): Promise<SettingsRow> {
  const { data } = await ctx.supabase.from('proposal_settings').select('*').eq('organization_id', ctx.membership.organization_id).maybeSingle();
  const row = data as (Omit<SettingsRow, 'max_discount_member_pct' | 'max_discount_manager_pct'> & { max_discount_member_pct: number | string; max_discount_manager_pct: number | string }) | null;
  if (!row) throw new Error('Configuração comercial ausente para esta organização.');
  return { ...row, max_discount_member_pct: Number(row.max_discount_member_pct), max_discount_manager_pct: Number(row.max_discount_manager_pct) };
}

/** Expira, no banco, as propostas cuja validade passou (idempotente). Chamada ao abrir painel e listas. */
export async function expireOverdue(ctx: Context): Promise<void> {
  await ctx.supabase.rpc('prop_expire_overdue', { p_org: ctx.membership.organization_id });
}

// ------------------------------------------------------------------ clientes
type ListResult<T> = { rows: T[]; total: number };

export async function listClients(ctx: Context, p: { q: string; archived: boolean; page: number }): Promise<ListResult<ClientRow>> {
  let query = ctx.supabase.from('clients').select('*', { count: 'exact' }).eq('organization_id', ctx.membership.organization_id);
  query = p.archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  if (p.q) query = query.or(`name.ilike.%${p.q}%,legal_name.ilike.%${p.q}%,email.ilike.%${p.q}%`);
  const from = (p.page - 1) * PAGE_SIZE;
  const { data, count } = await query.order('name').range(from, from + PAGE_SIZE - 1);
  return { rows: (data ?? []) as ClientRow[], total: count ?? 0 };
}

export async function listClientOptions(ctx: Context): Promise<Array<{ value: string; label: string }>> {
  const { data } = await ctx.supabase.from('clients').select('id, name').eq('organization_id', ctx.membership.organization_id).is('archived_at', null).order('name').limit(1000);
  return ((data ?? []) as Array<{ id: string; name: string }>).map((c) => ({ value: c.id, label: c.name }));
}

export async function getClient(ctx: Context, id: string): Promise<ClientRow | null> {
  const { data } = await ctx.supabase.from('clients').select('*').eq('id', id).eq('organization_id', ctx.membership.organization_id).maybeSingle();
  return (data as ClientRow | null) ?? null;
}

// ------------------------------------------------------------------ catálogo
export async function listCatalog(ctx: Context, p: { q: string; type: string; status: string; page: number }): Promise<ListResult<CatalogRow>> {
  let query = ctx.supabase.from('catalog_items').select('*', { count: 'exact' }).eq('organization_id', ctx.membership.organization_id);
  if (p.type === 'product' || p.type === 'service') query = query.eq('type', p.type);
  if (p.status === 'active') query = query.eq('active', true);
  if (p.status === 'inactive') query = query.eq('active', false);
  if (p.q) query = query.or(`name.ilike.%${p.q}%,sku.ilike.%${p.q}%,description.ilike.%${p.q}%`);
  const from = (p.page - 1) * PAGE_SIZE;
  const { data, count } = await query.order('name').range(from, from + PAGE_SIZE - 1);
  return { rows: (data ?? []) as CatalogRow[], total: count ?? 0 };
}

export async function listActiveCatalog(ctx: Context): Promise<CatalogRow[]> {
  const { data } = await ctx.supabase.from('catalog_items').select('*').eq('organization_id', ctx.membership.organization_id).eq('active', true).order('name').limit(1000);
  return (data ?? []) as CatalogRow[];
}

// ------------------------------------------------------------------ propostas
export type ProposalListItem = ProposalRow & { client_name: string; total_cents: number | null; version: number | null };

export async function listProposals(
  ctx: Context,
  p: { q: string; status: string; owner: string | null; client: string | null; archived: boolean; page: number },
): Promise<ListResult<ProposalListItem>> {
  let query = ctx.supabase.from('proposals').select('*', { count: 'exact' }).eq('organization_id', ctx.membership.organization_id);
  query = p.archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  if (p.status) query = query.eq('status', p.status);
  if (p.owner) query = query.eq('owner_id', p.owner);
  if (p.client) query = query.eq('client_id', p.client);
  if (p.q) query = query.or(`title.ilike.%${p.q}%,proposal_number.ilike.%${p.q}%`);
  const from = (p.page - 1) * PAGE_SIZE;
  const { data, count } = await query.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as ProposalRow[];
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const revIds = [...new Set(rows.map((r) => r.published_revision_id ?? r.current_revision_id).filter((x): x is string => Boolean(x)))];
  const [clients, revs] = await Promise.all([
    clientIds.length ? ctx.supabase.from('clients').select('id, name').in('id', clientIds) : Promise.resolve({ data: [] }),
    revIds.length ? ctx.supabase.from('proposal_revisions').select('id, total_cents, version_number').in('id', revIds) : Promise.resolve({ data: [] }),
  ]);
  const cMap = new Map(((clients.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const rMap = new Map(((revs.data ?? []) as Array<{ id: string; total_cents: number; version_number: number }>).map((r) => [r.id, r]));
  return {
    rows: rows.map((r) => {
      const rev = rMap.get(r.published_revision_id ?? r.current_revision_id ?? '');
      return { ...r, client_name: cMap.get(r.client_id) ?? '—', total_cents: rev?.total_cents ?? null, version: rev?.version_number ?? null };
    }),
    total: count ?? 0,
  };
}

export type ProposalDetail = {
  proposal: ProposalRow;
  client: ClientRow | null;
  revisions: RevisionRow[];
  current: RevisionRow | null;
  items: ItemRow[];
  events: EventRow[];
  links: LinkRow[];
  decisions: DecisionRow[];
  emails: EmailRow[];
};

/** Proposta com tudo que a tela precisa. O RLS decide o que o usuário enxerga (vendedor: só as dele). */
export async function getProposal(ctx: Context, id: string, revisionId?: string | null): Promise<ProposalDetail | null> {
  const db = ctx.supabase;
  const org = ctx.membership.organization_id;
  const { data: proposal } = await db.from('proposals').select('*').eq('id', id).eq('organization_id', org).maybeSingle();
  if (!proposal) return null;
  const p = proposal as ProposalRow;
  const [client, revisions, events, links, decisions, emails] = await Promise.all([
    db.from('clients').select('*').eq('id', p.client_id).maybeSingle(),
    db.from('proposal_revisions').select('*').eq('proposal_id', id).order('version_number', { ascending: false }),
    db.from('proposal_events').select('*').eq('proposal_id', id).order('id', { ascending: false }).limit(200),
    db.from('proposal_share_links').select('id, revision_id, expires_at, revoked_at, created_at').eq('proposal_id', id).order('created_at', { ascending: false }),
    db.from('proposal_decisions').select('id, revision_id, decision, client_name, client_email, comment, created_at').eq('proposal_id', id).order('created_at', { ascending: false }),
    db.from('proposal_email_deliveries').select('id, recipient_email, delivery_status, error_message, attempted_at').eq('proposal_id', id).order('attempted_at', { ascending: false }).limit(20),
  ]);
  const revs = (revisions.data ?? []) as RevisionRow[];
  const wanted = revisionId ?? p.current_revision_id;
  const current = revs.find((r) => r.id === wanted) ?? revs[0] ?? null;
  const items = current
    ? (((await db.from('proposal_items').select('*').eq('revision_id', current.id).order('position')).data ?? []) as ItemRow[])
    : [];
  return {
    proposal: p, client: (client.data as ClientRow | null) ?? null, revisions: revs, current, items,
    events: (events.data ?? []) as EventRow[], links: (links.data ?? []) as LinkRow[], decisions: (decisions.data ?? []) as DecisionRow[], emails: (emails.data ?? []) as EmailRow[],
  };
}

/** Conteúdo seguro (sanitizado) da revisão, para o editor e a prévia. */
export const contentOf = (rev: RevisionRow | null): ProposalContent => sanitizeContent(rev?.content_json);

export async function listGoals(ctx: Context): Promise<GoalRow[]> {
  const { data } = await ctx.supabase.from('commercial_goals').select('id, user_id, period_start, period_end, target_value_cents').eq('organization_id', ctx.membership.organization_id).order('period_start', { ascending: false });
  return (data ?? []) as GoalRow[];
}

export type ClientSummary = { proposals: ProposalListItem[]; proposedCents: number; acceptedCents: number; acceptedCount: number };

/** Resumo comercial de um cliente: propostas (últimas 100), valor proposto (enviadas, exceto canceladas) e valor aceito. */
export async function clientSummary(ctx: Context, clientId: string): Promise<ClientSummary> {
  const { rows } = await listProposals(ctx, { q: '', status: '', owner: null, client: clientId, archived: false, page: 1 });
  const ids = rows.map((r) => r.id);
  let accepted: Array<{ revision_id: string }> = [];
  if (ids.length) {
    const { data } = await ctx.supabase.from('proposal_decisions').select('revision_id').in('proposal_id', ids).eq('decision', 'accepted');
    accepted = (data ?? []) as Array<{ revision_id: string }>;
  }
  let acceptedCents = 0;
  if (accepted.length) {
    const { data } = await ctx.supabase.from('proposal_revisions').select('total_cents').in('id', accepted.map((a) => a.revision_id));
    acceptedCents = ((data ?? []) as Array<{ total_cents: number }>).reduce((s, r) => s + r.total_cents, 0);
  }
  const proposedCents = rows.filter((r) => r.status !== 'draft' && r.status !== 'cancelled').reduce((s, r) => s + (r.total_cents ?? 0), 0);
  return { proposals: rows, proposedCents, acceptedCents, acceptedCount: accepted.length };
}

/** Propostas pendentes de resposta (enviadas ou visualizadas), das mais antigas para as mais novas. */
export async function listPending(ctx: Context, limit = 100): Promise<ProposalListItem[]> {
  const { data } = await ctx.supabase
    .from('proposals').select('*').eq('organization_id', ctx.membership.organization_id).is('archived_at', null).in('status', ['sent', 'viewed'])
    .order('first_sent_at', { ascending: true }).limit(limit);
  const rows = (data ?? []) as ProposalRow[];
  if (rows.length === 0) return [];
  const [clients, revs] = await Promise.all([
    ctx.supabase.from('clients').select('id, name').in('id', [...new Set(rows.map((r) => r.client_id))]),
    ctx.supabase.from('proposal_revisions').select('id, total_cents, version_number, valid_until').in('id', rows.map((r) => r.published_revision_id).filter((x): x is string => Boolean(x))),
  ]);
  const cMap = new Map(((clients.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const rMap = new Map(((revs.data ?? []) as Array<{ id: string; total_cents: number; version_number: number }>).map((r) => [r.id, r]));
  return rows.map((r) => ({ ...r, client_name: cMap.get(r.client_id) ?? '—', total_cents: rMap.get(r.published_revision_id ?? '')?.total_cents ?? null, version: rMap.get(r.published_revision_id ?? '')?.version_number ?? null }));
}
