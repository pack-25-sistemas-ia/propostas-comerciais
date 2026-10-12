'use client';

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatMoneyCompact, formatPct } from '@/lib/proposals/format';
import { STATUS_LABELS, type ProposalStatus } from '@/lib/proposals/filters';

// Dados já preparados no servidor (rótulos legíveis, dinheiro em CENTAVOS). Todos os valores vêm do banco; nada é fixo.
export type PeriodRow = { label: string; created: number; sent: number; accepted: number; declined: number; proposed_cents: number; accepted_cents: number; rate: number | null };
export type StatusData = { status: ProposalStatus; count: number; cents: number };
export type RepData = { name: string; sent: number; accepted: number; accepted_cents: number };
export type ClientData = { name: string; accepted_cents: number; accepted: number };

const STATUS_COLOR: Record<ProposalStatus, string> = {
  draft: '#64748b', sent: '#d97706', viewed: '#7c3aed', accepted: '#047857', declined: '#b91c1c', expired: '#9a3412', cancelled: '#94a3b8',
};
const TICK = { fill: 'currentColor', fontSize: 12 };
const TOOLTIP = { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' };

function ChartFrame({ title, description, empty, children, table }: { title: string; description: string; empty: boolean; children: React.ReactNode; table: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm" aria-label={title}>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{description}</p>
      {empty ? (
        <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted">Sem dados no período selecionado</p>
      ) : (
        <div className="h-[260px] w-full text-muted">{children}</div>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Ver dados em tabela</summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </section>
  );
}

const TH = 'px-2 py-1 text-left font-medium text-muted';
const TD = 'px-2 py-1 tabular-nums';
const Table = ({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) => (
  <table className="w-full text-xs"><caption className="sr-only">{caption}</caption><thead><tr>{head.map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
);

/** 1 — Evolução de propostas: criadas e enviadas por período. */
export function EvolutionChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame
      title="Evolução de propostas" description="Propostas criadas e propostas enviadas (primeiro envio) por período."
      empty={rows.every((r) => r.created === 0 && r.sent === 0)}
      table={<Table caption="Evolução de propostas" head={['Período', 'Criadas', 'Enviadas']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.created}</td><td className={TD}>{r.sent}</td></tr>)}</Table>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="created" name="Criadas" fill="#64748b" radius={[4, 4, 0, 0]} />
          <Bar dataKey="sent" name="Enviadas" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 2 — Aceitas × recusadas. */
export function DecisionsChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame
      title="Aceitas × recusadas" description="Propostas decididas pelo cliente em cada período (pela data da decisão)."
      empty={rows.every((r) => r.accepted === 0 && r.declined === 0)}
      table={<Table caption="Aceitas e recusadas" head={['Período', 'Aceitas', 'Recusadas']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.accepted}</td><td className={TD}>{r.declined}</td></tr>)}</Table>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="accepted" name="Aceitas" fill="#047857" radius={[4, 4, 0, 0]} />
          <Bar dataKey="declined" name="Recusadas" fill="#b91c1c" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 3 — Valor proposto × valor aceito. */
export function ValueChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame
      title="Valor proposto × valor aceito" description="Proposto: valor das propostas enviadas no período. Aceito: valor das aceitas no período. São grupos diferentes: o aceito de um mês pode vir de propostas enviadas antes."
      empty={rows.every((r) => r.proposed_cents === 0 && r.accepted_cents === 0)}
      table={<Table caption="Valor proposto e aceito" head={['Período', 'Proposto', 'Aceito']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{formatMoney(r.proposed_cents)}</td><td className={TD}>{formatMoney(r.accepted_cents)}</td></tr>)}</Table>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} tickFormatter={(v) => formatMoneyCompact(Number(v))} width={84} />
          <Tooltip formatter={(v) => formatMoney(Number(v))} contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="proposed_cents" name="Valor proposto" fill="#162a43" radius={[4, 4, 0, 0]} />
          <Bar dataKey="accepted_cents" name="Valor aceito" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 4 — Distribuição por status. */
export function StatusChart({ rows }: { rows: StatusData[] }) {
  return (
    <ChartFrame
      title="Distribuição por status" description="Status atual das propostas criadas no período."
      empty={rows.length === 0}
      table={<Table caption="Distribuição por status" head={['Status', 'Propostas', 'Valor']}>{rows.map((r) => <tr key={r.status}><td className={TD}>{STATUS_LABELS[r.status]}</td><td className={TD}>{r.count}</td><td className={TD}>{formatMoney(r.cents)}</td></tr>)}</Table>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows.map((r) => ({ name: STATUS_LABELS[r.status], value: r.count, status: r.status }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={78} paddingAngle={2} isAnimationActive={false}>
            {rows.map((r) => <Cell key={r.status} fill={STATUS_COLOR[r.status]} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 5 — Desempenho por vendedor. */
export function RepChart({ rows }: { rows: RepData[] }) {
  return (
    <ChartFrame
      title="Desempenho por vendedor" description="Propostas enviadas e aceitas no período; o valor aceito está na tabela."
      empty={rows.every((r) => r.sent === 0 && r.accepted === 0)}
      table={<Table caption="Desempenho por vendedor" head={['Vendedor', 'Enviadas', 'Aceitas', 'Valor aceito']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.sent}</td><td className={TD}>{r.accepted}</td><td className={TD}>{formatMoney(r.accepted_cents)}</td></tr>)}</Table>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
          <XAxis dataKey="name" tick={TICK} interval={0} />
          <YAxis tick={TICK} allowDecimals={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          <Bar dataKey="sent" name="Enviadas" fill="#0891b2" radius={[4, 4, 0, 0]} />
          <Bar dataKey="accepted" name="Aceitas" fill="#047857" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 6 — Ranking de clientes por valor aceito. */
export function ClientsChart({ rows }: { rows: ClientData[] }) {
  return (
    <ChartFrame
      title="Ranking de clientes" description="Clientes com maior valor aceito no período."
      empty={rows.length === 0}
      table={<Table caption="Ranking de clientes" head={['Cliente', 'Aceitas', 'Valor aceito']}>{rows.map((r) => <tr key={r.name}><td className={TD}>{r.name}</td><td className={TD}>{r.accepted}</td><td className={TD}>{formatMoney(r.accepted_cents)}</td></tr>)}</Table>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} horizontal={false} />
          <XAxis type="number" tick={TICK} tickFormatter={(v) => formatMoneyCompact(Number(v))} />
          <YAxis type="category" dataKey="name" tick={TICK} width={110} />
          <Tooltip formatter={(v) => formatMoney(Number(v))} contentStyle={TOOLTIP} />
          <Bar dataKey="accepted_cents" name="Valor aceito" fill="#162a43" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** 7 — Evolução da taxa de aceite (pela data da decisão; períodos sem decisões ficam em branco). */
export function RateChart({ rows }: { rows: PeriodRow[] }) {
  return (
    <ChartFrame
      title="Evolução da taxa de aceite" description="Aceitas ÷ (aceitas + recusadas), pela data da decisão. Período sem decisões não tem taxa."
      empty={rows.every((r) => r.rate === null)}
      table={<Table caption="Evolução da taxa de aceite" head={['Período', 'Aceitas', 'Recusadas', 'Taxa']}>{rows.map((r) => <tr key={r.label}><td className={TD}>{r.label}</td><td className={TD}>{r.accepted}</td><td className={TD}>{r.declined}</td><td className={TD}>{formatPct(r.rate)}</td></tr>)}</Table>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis tick={TICK} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={44} />
          <Tooltip formatter={(v) => formatPct(Number(v))} contentStyle={TOOLTIP} />
          <Line type="monotone" dataKey="rate" name="Taxa de aceite" stroke="#0891b2" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
