import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/primitives';
import { FilterBar } from '@/components/app/filter-bar';
import { ClientsChartClient, DecisionsChartClient, EvolutionChartClient, RateChartClient, RepChartClient, StatusChartClient, ValueChartClient } from '@/components/proposals/charts-loader';
import { requireContext } from '@/lib/auth/session';
import { isManager, type SearchParams } from '@/lib/proposals/access';
import { ALERT_TITLES, goalsInPeriod, periodRows, repRows, summarizeGoals } from '@/lib/proposals/chart-rows';
import { loadDashboard, variationPct, type AlertRow } from '@/lib/proposals/dashboard';
import { expireOverdue, labelMap, listClientOptions, loadPeople, loadSettings, personOptions } from '@/lib/proposals/data';
import { filtersToQuery, parseFilters } from '@/lib/proposals/filters';
import { formatDate, formatDays, formatMoney, formatPct } from '@/lib/proposals/format';

export const metadata: Metadata = { title: 'Painel' };

function Kpi({ label, value, hint, help, trend, muted }: { label: string; value: string; hint: string; help: string; trend?: string | null; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm" title={help}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${muted ? 'text-muted' : ''}`}>{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
      {trend ? <p className="mt-1 text-xs font-medium">{trend}</p> : null}
    </div>
  );
}

/** Variação em texto ("▲ +12,5% vs período anterior"): não depende só de cor. */
function trendText(v: number | null, suffix = '%'): string | null {
  if (v === null) return null;
  const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '■';
  return `${arrow} ${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${suffix} vs período anterior`;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const manager = isManager(ctx.membership.role);

  await expireOverdue(ctx);
  const [people, clients, data, settings] = await Promise.all([loadPeople(ctx), listClientOptions(ctx), loadDashboard(ctx, filters), loadSettings(ctx)]);
  const labels = labelMap(people);
  const query = filtersToQuery(filters);

  if (data.error || !data.kpis) {
    return (
      <>
        <PageHeader title="Painel" />
        <Alert tone="error">Não foi possível carregar os indicadores agora. Tente novamente em instantes.</Alert>
      </>
    );
  }

  const k = data.kpis;
  const p = data.previous;
  const series = periodRows(data.series, filters.from, filters.to);
  const goals = goalsInPeriod(data.goals, filters.from, filters.to);
  const goalSum = summarizeGoals(goals);
  const alertsByKind = (kind: AlertRow['kind']) => data.alerts.filter((a) => a.kind === kind);
  // vazio = nada aconteceu NO PERÍODO (o valor em negociação é situação atual e não conta)
  const empty = k.created_count === 0 && k.sent_count === 0 && k.accepted_count === 0 && k.declined_count === 0;

  return (
    <>
      <PageHeader title="Painel" description={`Período: ${formatDate(filters.from)} a ${formatDate(filters.to)}. Números calculados do banco de dados; fórmulas em docs/METRICS.md.`}>
        <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/relatorios?${query}`}>Relatórios</Link>
      </PageHeader>

      <FilterBar action="/dashboard" filters={filters} owners={manager ? personOptions(people) : undefined} clients={clients} />
      {!manager ? <div className="mb-4"><Alert tone="info">Você vê os números das suas próprias propostas.</Alert></div> : null}
      {empty ? <div className="mb-4"><Alert tone="info">Ainda não há propostas neste período. Crie a primeira em «Propostas» ou amplie o período.</Alert></div> : null}

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Propostas criadas" value={k.created_count.toLocaleString('pt-BR')} hint="No período. Revisões não contam como proposta nova." help="Quantidade de propostas criadas no período; novas versões da mesma proposta não entram." trend={trendText(variationPct(k.created_count, p?.created_count ?? null))} />
        <Kpi label="Propostas enviadas" value={k.sent_count.toLocaleString('pt-BR')} hint="Primeiro envio ocorrido no período." help="Propostas cuja primeira publicação aconteceu no período." trend={trendText(variationPct(k.sent_count, p?.sent_count ?? null))} />
        <Kpi label="Propostas aceitas" value={k.accepted_count.toLocaleString('pt-BR')} hint="Aceites registrados no período." help="Aceites do cliente, pela data da decisão." trend={trendText(variationPct(k.accepted_count, p?.accepted_count ?? null))} />
        <Kpi label="Valor aceito" value={formatMoney(k.accepted_cents)} hint="Soma das propostas aceitas no período. Não é faturamento." help="Soma do valor das revisões aceitas no período. Valor comercial, não recebimento." trend={trendText(variationPct(k.accepted_cents, p?.accepted_cents ?? null))} />
        <Kpi label="Valor em negociação" value={formatMoney(k.pipeline_cents)} hint={`${k.pipeline_count} proposta(s) enviada(s) ou visualizada(s) e ainda válida(s) · situação atual`} help="Revisão vigente das propostas enviadas ou visualizadas, dentro da validade. Não depende do período." />
        <Kpi label="Taxa de aceite" value={formatPct(k.acceptance_rate)} hint={k.acceptance_rate === null ? 'Sem propostas decididas no período' : `${k.accepted_count} aceita(s) ÷ (${k.accepted_count} + ${k.declined_count} recusada(s))`} help="Aceitas ÷ (aceitas + recusadas) × 100, entre propostas decididas no período." muted={k.acceptance_rate === null} trend={p && k.acceptance_rate !== null && p.acceptance_rate !== null ? trendText(Math.round((k.acceptance_rate - p.acceptance_rate) * 10) / 10, ' p.p.') : null} />
        <Kpi label="Ticket médio aceito" value={formatMoney(k.avg_ticket_cents)} hint={k.avg_ticket_cents === null ? 'Sem propostas aceitas no período' : 'Valor aceito ÷ propostas aceitas'} help="Valor aceito dividido pela quantidade de propostas aceitas no período." muted={k.avg_ticket_cents === null} trend={trendText(variationPct(k.avg_ticket_cents, p?.avg_ticket_cents ?? null))} />
        <Kpi label="Tempo até a decisão" value={formatDays(k.avg_days_to_decision)} hint={k.avg_days_to_decision === null ? 'Sem decisões no período' : 'Do primeiro envio ao aceite ou recusa (média)'} help="Média de dias entre o primeiro envio e a decisão, das propostas decididas no período." muted={k.avg_days_to_decision === null} />
      </section>

      <section aria-label="Gráficos" className="mt-6 grid gap-4 lg:grid-cols-2">
        <EvolutionChartClient rows={series} />
        <DecisionsChartClient rows={series} />
        <ValueChartClient rows={series} />
        <StatusChartClient rows={data.statuses.map((s) => ({ status: s.status, count: s.proposal_count, cents: s.total_cents }))} />
        <RepChartClient rows={repRows(data.reps, labels)} />
        <ClientsChartClient rows={data.clients.map((c) => ({ name: c.client_name, accepted_cents: c.accepted_cents, accepted: c.accepted_count }))} />
        <RateChartClient rows={series} />
      </section>

      <section aria-label="Alertas e metas" className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Alertas" description={`Vencimento: até ${settings.alert_expiring_days} dia(s). Sem retorno: mais de ${settings.alert_no_reply_days} dia(s) desde o envio. Aceites recentes: ${settings.alert_recent_accept_days} dia(s).`}>
          {data.alerts.length === 0 ? <p className="text-sm text-muted">Nenhum alerta no momento. Tudo em dia.</p> : (
            <div className="space-y-4">
              {(Object.keys(ALERT_TITLES) as AlertRow['kind'][]).map((kind) => {
                const list = alertsByKind(kind);
                if (list.length === 0) return null;
                return (
                  <div key={kind}>
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">{ALERT_TITLES[kind]} <Badge tone={kind === 'recent_accept' ? 'success' : kind === 'overdue' ? 'danger' : 'warning'}>{list.length}</Badge></h3>
                    <ul className="space-y-1 text-sm">
                      {list.slice(0, 5).map((a) => (
                        <li key={`${kind}-${a.proposal_id}`}>
                          <Link className="underline-offset-2 hover:underline" href={`/propostas/${a.proposal_id}`}>
                            {a.proposal_number} · {a.client_name} · {formatMoney(a.total_cents)} · {kind === 'expiring' ? (a.days === 0 ? 'vence hoje' : `vence em ${a.days} dia(s)`) : kind === 'overdue' ? `venceu há ${a.days} dia(s)` : kind === 'no_reply' ? `${a.days} dia(s) sem retorno` : a.days === 0 ? 'aceita hoje' : `aceita há ${a.days} dia(s)`}
                          </Link>
                          {a.owner_id && manager ? <span className="text-muted"> · {labels.get(a.owner_id) ?? 'Usuário'}</span> : null}
                        </li>
                      ))}
                      {list.length > 5 ? <li className="text-muted">e mais {list.length - 5}…</li> : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="Metas" description="Valor aceito dentro do período de cada meta. Metas que cruzam o período filtrado.">
          {goals.length === 0 ? <p className="text-sm text-muted">Nenhuma meta para o período. {manager ? <Link className="underline" href="/metas">Definir metas</Link> : null}</p> : (
            <div className="space-y-3">
              <p className="text-sm"><strong className="tabular-nums">{formatPct(goalSum.pct)}</strong> <span className="text-muted">— {formatMoney(goalSum.achievedCents)} de {formatMoney(goalSum.targetCents)} · {goalSum.met} de {goalSum.count} meta(s) atingida(s)</span></p>
              <ul className="space-y-3">
                {goals.map((g) => (
                  <li key={g.goal_id} className="text-sm">
                    <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{labels.get(g.user_id) ?? 'Usuário'}</span><span className="text-muted">{formatDate(g.period_start)} a {formatDate(g.period_end)}</span></div>
                    <progress className="h-2 w-full" max={100} value={Math.min(100, g.pct ?? 0)} aria-label={`Progresso da meta de ${labels.get(g.user_id) ?? 'usuário'}`} />
                    <div className="text-xs text-muted">{formatMoney(g.achieved_cents)} de {formatMoney(g.target_cents)} · {formatPct(g.pct)} · {formatPct(g.elapsed_pct)} do período decorrido</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
