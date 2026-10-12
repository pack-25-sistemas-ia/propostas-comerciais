'use client';

import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui/primitives';
import { ITEM_TYPE_LABELS, ITEM_TYPES, PERIOD_LABELS, PERIODS, STATUSES, STATUS_LABELS, type Period, type ProposalFilters } from '@/lib/proposals/filters';

type Opt = { value: string; label: string };

/** Filtros globais do painel e dos relatórios (período, vendedor, cliente, status, tipo). Envia por GET: a URL é compartilhável. */
export function FilterBar({ action, filters, owners, clients }: { action: string; filters: ProposalFilters; owners?: Opt[]; clients: Opt[] }) {
  const [period, setPeriod] = useState<Period>(filters.period);
  return (
    <form action={action} method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3" aria-label="Filtros do período">
      <div>
        <label htmlFor="period" className="mb-1 block text-xs font-medium text-muted">Período</label>
        <Select id="period" name="period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-48">
          {PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
        </Select>
      </div>
      {period === 'custom' ? (
        <>
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-medium text-muted">De</label>
            <Input id="from" name="from" type="date" defaultValue={filters.from} required />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-medium text-muted">Até</label>
            <Input id="to" name="to" type="date" defaultValue={filters.to} required />
          </div>
        </>
      ) : null}
      {owners ? (
        <div>
          <label htmlFor="owner" className="mb-1 block text-xs font-medium text-muted">Vendedor</label>
          <Select id="owner" name="owner" defaultValue={filters.owner ?? ''} className="w-44">
            <option value="">Todos</option>
            {owners.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      ) : null}
      <div>
        <label htmlFor="client" className="mb-1 block text-xs font-medium text-muted">Cliente</label>
        <Select id="client" name="client" defaultValue={filters.client ?? ''} className="w-44">
          <option value="">Todos</option>
          {clients.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>
      <div>
        <label htmlFor="status" className="mb-1 block text-xs font-medium text-muted">Status</label>
        <Select id="status" name="status" defaultValue={filters.status ?? ''} className="w-36">
          <option value="">Todos</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
      </div>
      <div>
        <label htmlFor="type" className="mb-1 block text-xs font-medium text-muted">Tipo de item</label>
        <Select id="type" name="type" defaultValue={filters.itemType ?? ''} className="w-36">
          <option value="">Todos</option>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}
        </Select>
      </div>
      <Button type="submit">Aplicar</Button>
    </form>
  );
}
