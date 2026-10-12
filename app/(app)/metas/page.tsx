import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ActionButton } from '@/components/app/form-kit';
import { GoalForm } from '@/components/proposals/forms';
import { requireContext } from '@/lib/auth/session';
import { isManager } from '@/lib/proposals/access';
import { deleteGoal } from '@/lib/proposals/actions';
import { labelMap, loadPeople, personOptions } from '@/lib/proposals/data';
import { formatDate, formatMoney, formatPct } from '@/lib/proposals/format';
import type { GoalProgressRow } from '@/lib/proposals/dashboard';

export const metadata: Metadata = { title: 'Metas' };

export default async function GoalsPage() {
  const ctx = await requireContext();
  const manage = isManager(ctx.membership.role);
  const org = ctx.membership.organization_id;
  const [people, progress] = await Promise.all([loadPeople(ctx), ctx.supabase.rpc('prop_goals_progress', { p_org: org, p_owner: null })]);
  const labels = labelMap(people);
  const goals = ((progress.data ?? []) as Array<Record<string, unknown>>).map((x): GoalProgressRow => ({
    goal_id: String(x.goal_id), user_id: String(x.user_id), period_start: String(x.period_start), period_end: String(x.period_end),
    target_cents: Number(x.target_cents), achieved_cents: Number(x.achieved_cents), pct: x.pct === null ? null : Number(x.pct), elapsed_pct: Number(x.elapsed_pct),
  }));

  return (
    <>
      <PageHeader title="Metas" description="Meta de valor aceito por vendedor. O realizado soma só as propostas aceitas dentro do período da própria meta." />
      {manage ? <Card title="Nova meta" className="mb-6"><GoalForm people={personOptions(people)} /></Card> : null}
      <Card title="Acompanhamento">
        {goals.length === 0 ? <EmptyState title="Nenhuma meta" description={manage ? 'Crie a primeira meta acima.' : 'Seu gestor ainda não definiu metas.'} /> : (
          <ul className="space-y-3">
            {goals.map((g) => (
              <li key={g.goal_id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-medium">{labels.get(g.user_id) ?? 'Usuário'}</p><p className="text-xs text-muted">{formatDate(g.period_start)} a {formatDate(g.period_end)}</p></div>
                  {manage ? <ActionButton label="Apagar" confirm="Apagar esta meta?" action={() => deleteGoal(g.goal_id)} /> : null}
                </div>
                <progress className="mt-2 h-2 w-full" max={100} value={Math.min(100, g.pct ?? 0)} aria-label={`Progresso da meta de ${labels.get(g.user_id) ?? 'usuário'}`} />
                <p className="mt-1 text-xs text-muted">{formatMoney(g.achieved_cents)} de {formatMoney(g.target_cents)} · <strong>{formatPct(g.pct)}</strong> · {formatPct(g.elapsed_pct)} do período decorrido</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
