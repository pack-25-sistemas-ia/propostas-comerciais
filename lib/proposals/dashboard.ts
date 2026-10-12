import 'server-only';
import type { Context } from '@/lib/auth/session';
import { addDays, daysBetween, type ProposalFilters, type ProposalStatus } from './filters';

// Leitura dos indicadores (todos calculados em funções SQL; ver docs/METRICS.md). Nenhum número é fixo.
export type Kpis = {
  created_count: number; sent_count: number; accepted_count: number; declined_count: number; accepted_cents: number;
  pipeline_cents: number; pipeline_count: number; acceptance_rate: number | null; avg_ticket_cents: number | null; avg_days_to_decision: number | null;
};
export type SeriesPoint = {
  bucket: string; created_count: number; sent_count: number; proposed_cents: number; accepted_count: number; declined_count: number; accepted_cents: number; acceptance_rate: number | null;
};
export type StatusRow = { status: ProposalStatus; proposal_count: number; total_cents: number };
export type RepRow = { owner_id: string | null; sent_count: number; accepted_count: number; declined_count: number; accepted_cents: number; acceptance_rate: number | null };
export type ClientRankRow = { client_id: string; client_name: string; accepted_count: number; accepted_cents: number; proposed_cents: number };
export type AlertRow = { kind: 'expiring' | 'overdue' | 'no_reply' | 'recent_accept'; proposal_id: string; proposal_number: string; title: string; client_name: string; owner_id: string | null; days: number; total_cents: number };
export type GoalProgressRow = { goal_id: string; user_id: string; period_start: string; period_end: string; target_cents: number; achieved_cents: number; pct: number | null; elapsed_pct: number };

export type DashboardData = {
  kpis: Kpis | null;
  /** mesmos indicadores no período imediatamente anterior, de igual duração (para a variação) */
  previous: Kpis | null;
  series: SeriesPoint[];
  statuses: StatusRow[];
  reps: RepRow[];
  clients: ClientRankRow[];
  alerts: AlertRow[];
  goals: GoalProgressRow[];
  error: boolean;
};

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function loadDashboard(ctx: Context, f: ProposalFilters): Promise<DashboardData> {
  const org = ctx.membership.organization_id;
  const db = ctx.supabase;
  const base = { p_org: org, p_from: f.from, p_to: f.to, p_owner: f.owner, p_client: f.client, p_status: f.status, p_type: f.itemType };
  const len = daysBetween(f.from, f.to) + 1;
  const prevTo = addDays(f.from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const [k, s, st, r, c, a, g, pk] = await Promise.all([
    db.rpc('prop_kpis', base),
    db.rpc('prop_series', base),
    db.rpc('prop_status_distribution', { p_org: org, p_from: f.from, p_to: f.to, p_owner: f.owner, p_client: f.client, p_type: f.itemType }),
    db.rpc('prop_rep_performance', base),
    db.rpc('prop_client_ranking', { p_org: org, p_from: f.from, p_to: f.to, p_owner: f.owner, p_status: f.status, p_type: f.itemType, p_limit: 10 }),
    db.rpc('prop_alerts', { p_org: org, p_owner: f.owner }),
    db.rpc('prop_goals_progress', { p_org: org, p_owner: f.owner }),
    db.rpc('prop_kpis', { ...base, p_from: prevFrom, p_to: prevTo }),
  ]);
  const error = Boolean(k.error || s.error || st.error || r.error || c.error || a.error || g.error);
  const toKpis = (row: Record<string, unknown> | undefined): Kpis | null => (row ? {
      created_count: num(row.created_count), sent_count: num(row.sent_count), accepted_count: num(row.accepted_count), declined_count: num(row.declined_count),
      accepted_cents: num(row.accepted_cents), pipeline_cents: num(row.pipeline_cents), pipeline_count: num(row.pipeline_count),
      acceptance_rate: numOrNull(row.acceptance_rate), avg_ticket_cents: numOrNull(row.avg_ticket_cents), avg_days_to_decision: numOrNull(row.avg_days_to_decision),
    } : null);
  return {
    error,
    kpis: toKpis(((k.data ?? []) as Array<Record<string, unknown>>)[0]),
    previous: pk.error ? null : toKpis(((pk.data ?? []) as Array<Record<string, unknown>>)[0]),
    series: ((s.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
      bucket: String(p.bucket), created_count: num(p.created_count), sent_count: num(p.sent_count), proposed_cents: num(p.proposed_cents), accepted_count: num(p.accepted_count),
      declined_count: num(p.declined_count), accepted_cents: num(p.accepted_cents), acceptance_rate: numOrNull(p.acceptance_rate),
    })),
    statuses: ((st.data ?? []) as Array<Record<string, unknown>>).map((x) => ({ status: x.status as ProposalStatus, proposal_count: num(x.proposal_count), total_cents: num(x.total_cents) })),
    reps: ((r.data ?? []) as Array<Record<string, unknown>>).map((x) => ({
      owner_id: (x.owner_id as string | null) ?? null, sent_count: num(x.sent_count), accepted_count: num(x.accepted_count), declined_count: num(x.declined_count),
      accepted_cents: num(x.accepted_cents), acceptance_rate: numOrNull(x.acceptance_rate),
    })),
    clients: ((c.data ?? []) as Array<Record<string, unknown>>).map((x) => ({
      client_id: String(x.client_id), client_name: String(x.client_name), accepted_count: num(x.accepted_count), accepted_cents: num(x.accepted_cents), proposed_cents: num(x.proposed_cents),
    })),
    alerts: ((a.data ?? []) as Array<Record<string, unknown>>).map((x) => ({
      kind: x.kind as AlertRow['kind'], proposal_id: String(x.proposal_id), proposal_number: String(x.proposal_number), title: String(x.title), client_name: String(x.client_name),
      owner_id: (x.owner_id as string | null) ?? null, days: num(x.days), total_cents: num(x.total_cents),
    })),
    goals: ((g.data ?? []) as Array<Record<string, unknown>>).map((x) => ({
      goal_id: String(x.goal_id), user_id: String(x.user_id), period_start: String(x.period_start), period_end: String(x.period_end),
      target_cents: num(x.target_cents), achieved_cents: num(x.achieved_cents), pct: numOrNull(x.pct), elapsed_pct: num(x.elapsed_pct),
    })),
  };
}

// ---------------------------------------------------------------- rótulos de gráfico (puro e testável)
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Mesma regra do banco: períodos de até 90 dias agrupam por semana; maiores, por mês. */
export function bucketUnit(from: string, to: string): 'week' | 'month' {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return days <= 90 ? 'week' : 'month';
}

/** 'YYYY-MM-DD' (início do bucket) -> "31/08" (semana) ou "set/26" (mês). */
export function bucketLabel(bucket: string, unit: 'week' | 'month'): string {
  const [y, m, d] = bucket.split('-');
  if (!y || !m || !d) return bucket;
  return unit === 'week' ? `${d}/${m}` : `${MONTHS[Number(m) - 1] ?? m}/${y.slice(2)}`;
}

/** Variação percentual entre períodos; `null` quando não faz sentido (base zero ou ausente). */
export function variationPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
