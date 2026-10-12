// Preparação (pura e testável) dos dados dos gráficos e dos cartões do painel.
import type { AlertRow, GoalProgressRow, RepRow, SeriesPoint } from './dashboard';
import type { PeriodRow, RepData } from '@/components/proposals/charts';

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

export function periodRows(series: SeriesPoint[], from: string, to: string): PeriodRow[] {
  const unit = bucketUnit(from, to);
  return series.map((p) => ({
    label: bucketLabel(p.bucket, unit), created: p.created_count, sent: p.sent_count, accepted: p.accepted_count, declined: p.declined_count,
    proposed_cents: p.proposed_cents, accepted_cents: p.accepted_cents, rate: p.acceptance_rate,
  }));
}

export function repRows(reps: RepRow[], labels: Map<string, string>): RepData[] {
  return reps.map((r) => ({ name: r.owner_id ? labels.get(r.owner_id) ?? 'Usuário' : 'Sem responsável', sent: r.sent_count, accepted: r.accepted_count, accepted_cents: r.accepted_cents }));
}

export type GoalSummary = { count: number; targetCents: number; achievedCents: number; pct: number | null; met: number };

/** Meta consolidada do cartão: Σ realizado ÷ Σ meta (em centavos, sem ponto flutuante); `null` sem metas. */
export function summarizeGoals(goals: GoalProgressRow[]): GoalSummary {
  const targetCents = goals.reduce((s, g) => s + g.target_cents, 0);
  const achievedCents = goals.reduce((s, g) => s + g.achieved_cents, 0);
  return {
    count: goals.length, targetCents, achievedCents,
    pct: targetCents > 0 ? Math.round((achievedCents * 10000) / targetCents) / 100 : null,
    met: goals.filter((g) => g.achieved_cents >= g.target_cents).length,
  };
}

/** Apenas metas que cruzam o período filtrado. */
export function goalsInPeriod(goals: GoalProgressRow[], from: string, to: string): GoalProgressRow[] {
  return goals.filter((g) => g.period_start <= to && g.period_end >= from);
}

export const ALERT_TITLES: Record<AlertRow['kind'], string> = {
  expiring: 'Próximas do vencimento', overdue: 'Vencidas', no_reply: 'Sem retorno', recent_accept: 'Aceitas recentemente',
};
