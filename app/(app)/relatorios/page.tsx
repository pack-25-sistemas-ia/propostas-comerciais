import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { FilterBar } from '@/components/app/filter-bar';
import { StatusBadge } from '@/components/proposals/status-badge';
import { requireContext } from '@/lib/auth/session';
import { isManager, type SearchParams } from '@/lib/proposals/access';
import { bucketLabel, bucketUnit } from '@/lib/proposals/chart-rows';
import { loadDashboard } from '@/lib/proposals/dashboard';
import { expireOverdue, labelMap, listClientOptions, listPending, loadPeople, personOptions } from '@/lib/proposals/data';
import { STATUS_LABELS, filtersToQuery, parseFilters } from '@/lib/proposals/filters';
import { formatDate, formatDays, formatMoney, formatPct } from '@/lib/proposals/format';

export const metadata: Metadata = { title: 'Relatórios' };

const TH = 'py-1 pr-3 text-left font-medium text-muted';
const TD = 'py-2 pr-3 tabular-nums';
const exportLink = 'inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';

function Section({ title, description, exportHref, children }: { title: string; description: string; exportHref?: string; children: React.ReactNode }) {
  return (
    <Card title={title} description={description}>
      {exportHref ? <div className="mb-3"><a className={exportLink} href={exportHref}>Exportar CSV</a></div> : null}
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const manager = isManager(ctx.membership.role);
  await expireOverdue(ctx);
  const [people, clients, data, pending] = await Promise.all([loadPeople(ctx), listClientOptions(ctx), loadDashboard(ctx, f), listPending(ctx)]);
  const labels = labelMap(people);
  const q = filtersToQuery(f);
  const unit = bucketUnit(f.from, f.to);
  const k = data.kpis;
  const overdue = data.alerts.filter((a) => a.kind === 'overdue');
  const empty = <p className="text-sm text-muted">Sem dados no período selecionado.</p>;

  if (data.error || !k) return <><PageHeader title="Relatórios" /><Alert tone="error">Não foi possível carregar os relatórios agora. Tente novamente em instantes.</Alert></>;

  return (
    <>
      <PageHeader title="Relatórios" description={`Período: ${formatDate(f.from)} a ${formatDate(f.to)}. Cada relatório pode ser exportado em CSV com os mesmos filtros.`}>
        <Link className={exportLink} href={`/dashboard?${q}`}>Voltar ao painel</Link>
      </PageHeader>
      <FilterBar action="/relatorios" filters={f} owners={manager ? personOptions(people) : undefined} clients={clients} />

      <div className="space-y-6">
        <Section title="Propostas por período" description={`Criadas, enviadas, decididas e valores por ${unit === 'week' ? 'semana' : 'mês'}.`} exportHref={`/export/series?${q}`}>
          {data.series.length === 0 ? empty : (
            <table className="w-full text-sm"><caption className="sr-only">Propostas por período</caption>
              <thead><tr><th className={TH}>Início</th><th className={`${TH} text-right`}>Criadas</th><th className={`${TH} text-right`}>Enviadas</th><th className={`${TH} text-right`}>Valor proposto</th><th className={`${TH} text-right`}>Aceitas</th><th className={`${TH} text-right`}>Recusadas</th><th className={`${TH} text-right`}>Valor aceito</th><th className={`${TH} text-right`}>Taxa de aceite</th></tr></thead>
              <tbody>{data.series.map((s) => (
                <tr key={s.bucket} className="border-t border-border"><td className={TD}>{bucketLabel(s.bucket, unit)}</td><td className={`${TD} text-right`}>{s.created_count}</td><td className={`${TD} text-right`}>{s.sent_count}</td><td className={`${TD} text-right`}>{formatMoney(s.proposed_cents)}</td><td className={`${TD} text-right`}>{s.accepted_count}</td><td className={`${TD} text-right`}>{s.declined_count}</td><td className={`${TD} text-right`}>{formatMoney(s.accepted_cents)}</td><td className={`${TD} text-right`}>{formatPct(s.acceptance_rate)}</td></tr>
              ))}</tbody></table>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Propostas por status" description="Status atual das propostas criadas no período." exportHref={`/export/status?${q}`}>
            {data.statuses.length === 0 ? empty : (
              <table className="w-full text-sm"><caption className="sr-only">Propostas por status</caption>
                <thead><tr><th className={TH}>Status</th><th className={`${TH} text-right`}>Propostas</th><th className={`${TH} text-right`}>Valor</th></tr></thead>
                <tbody>{data.statuses.map((s) => <tr key={s.status} className="border-t border-border"><td className={TD}>{STATUS_LABELS[s.status]}</td><td className={`${TD} text-right`}>{s.proposal_count}</td><td className={`${TD} text-right`}>{formatMoney(s.total_cents)}</td></tr>)}</tbody></table>
            )}
          </Section>
          <Section title="Taxa de aceite e tempo até a decisão" description="Entre propostas decididas no período.">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-muted">Taxa de aceite</dt><dd className="text-2xl font-semibold tabular-nums">{formatPct(k.acceptance_rate)}</dd><dd className="text-xs text-muted">{k.accepted_count} aceita(s) · {k.declined_count} recusada(s)</dd></div>
              <div><dt className="text-muted">Tempo médio até a decisão</dt><dd className="text-2xl font-semibold tabular-nums">{formatDays(k.avg_days_to_decision)}</dd></div>
              <div><dt className="text-muted">Valor aceito</dt><dd className="text-xl font-semibold tabular-nums">{formatMoney(k.accepted_cents)}</dd></div>
              <div><dt className="text-muted">Ticket médio aceito</dt><dd className="text-xl font-semibold tabular-nums">{formatMoney(k.avg_ticket_cents)}</dd></div>
            </dl>
          </Section>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Propostas por vendedor" description="Enviadas, decididas e valor aceito no período." exportHref={`/export/sales-by-rep?${q}`}>
            {data.reps.length === 0 ? empty : (
              <table className="w-full text-sm" aria-label="Propostas por vendedor"><caption className="sr-only">Propostas por vendedor</caption>
                <thead><tr><th className={TH}>Vendedor</th><th className={`${TH} text-right`}>Enviadas</th><th className={`${TH} text-right`}>Aceitas</th><th className={`${TH} text-right`}>Recusadas</th><th className={`${TH} text-right`}>Valor aceito</th><th className={`${TH} text-right`}>Taxa</th></tr></thead>
                <tbody>{data.reps.map((r, i) => <tr key={r.owner_id ?? i} className="border-t border-border"><td className={`${TD} font-medium`}>{r.owner_id ? labels.get(r.owner_id) ?? 'Usuário' : 'Sem responsável'}</td><td className={`${TD} text-right`}>{r.sent_count}</td><td className={`${TD} text-right`}>{r.accepted_count}</td><td className={`${TD} text-right`}>{r.declined_count}</td><td className={`${TD} text-right`}>{formatMoney(r.accepted_cents)}</td><td className={`${TD} text-right`}>{formatPct(r.acceptance_rate)}</td></tr>)}</tbody></table>
            )}
          </Section>
          <Section title="Propostas por cliente" description="Clientes com valor aceito no período (até 10)." exportHref={`/export/clients-ranking?${q}`}>
            {data.clients.length === 0 ? empty : (
              <table className="w-full text-sm" aria-label="Propostas por cliente"><caption className="sr-only">Propostas por cliente</caption>
                <thead><tr><th className={TH}>Cliente</th><th className={`${TH} text-right`}>Aceitas</th><th className={`${TH} text-right`}>Valor aceito</th><th className={`${TH} text-right`}>Valor proposto</th></tr></thead>
                <tbody>{data.clients.map((c) => <tr key={c.client_id} className="border-t border-border"><td className={`${TD} font-medium`}><Link className="hover:underline" href={`/clientes/${c.client_id}`}>{c.client_name}</Link></td><td className={`${TD} text-right`}>{c.accepted_count}</td><td className={`${TD} text-right`}>{formatMoney(c.accepted_cents)}</td><td className={`${TD} text-right`}>{formatMoney(c.proposed_cents)}</td></tr>)}</tbody></table>
            )}
          </Section>
        </div>

        <Section title="Propostas vencidas" description="Validade ultrapassada sem decisão do cliente." >
          {overdue.length === 0 ? <p className="text-sm text-muted">Nenhuma proposta vencida.</p> : (
            <table className="w-full text-sm"><caption className="sr-only">Propostas vencidas</caption>
              <thead><tr><th className={TH}>Nº</th><th className={TH}>Título</th><th className={TH}>Cliente</th><th className={`${TH} text-right`}>Valor</th><th className={`${TH} text-right`}>Dias de atraso</th></tr></thead>
              <tbody>{overdue.map((a) => <tr key={a.proposal_id} className="border-t border-border"><td className={TD}><Link className="underline-offset-2 hover:underline" href={`/propostas/${a.proposal_id}`}>{a.proposal_number}</Link></td><td className={TD}>{a.title}</td><td className={TD}>{a.client_name}</td><td className={`${TD} text-right`}>{formatMoney(a.total_cents)}</td><td className={`${TD} text-right`}>{a.days}</td></tr>)}</tbody></table>
          )}
        </Section>

        <Section title="Propostas pendentes" description="Enviadas ou visualizadas, aguardando resposta (situação atual).">
          {pending.length === 0 ? <p className="text-sm text-muted">Nenhuma proposta aguardando resposta.</p> : (
            <table className="w-full text-sm"><caption className="sr-only">Propostas pendentes</caption>
              <thead><tr><th className={TH}>Nº</th><th className={TH}>Título</th><th className={TH}>Cliente</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Valor</th><th className={TH}>Primeiro envio</th></tr></thead>
              <tbody>{pending.map((p) => <tr key={p.id} className="border-t border-border"><td className={TD}><Link className="underline-offset-2 hover:underline" href={`/propostas/${p.id}`}>{p.proposal_number}</Link></td><td className={TD}>{p.title}</td><td className={TD}>{p.client_name}</td><td className={TD}><StatusBadge status={p.status} /></td><td className={`${TD} text-right`}>{formatMoney(p.total_cents)}</td><td className={TD}>{p.first_sent_at ? formatDate(p.first_sent_at.slice(0, 10)) : '—'}</td></tr>)}</tbody></table>
          )}
        </Section>

        <Card title="Listas completas">
          <div className="flex flex-wrap gap-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- download (route handler), não é página */}
            <a className={exportLink} href="/export/proposals">Todas as propostas (CSV)</a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- download (route handler), não é página */}
            <a className={exportLink} href="/export/clients">Todos os clientes (CSV)</a>
          </div>
          <p className="mt-3 text-xs text-muted">As exportações respeitam o seu papel: vendedores exportam apenas o que enxergam.</p>
        </Card>
      </div>
    </>
  );
}
