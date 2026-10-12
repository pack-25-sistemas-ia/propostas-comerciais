import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ListFilters, Pagination } from '@/components/app/list-bits';
import { ProposalsTable } from '@/components/proposals/tables';
import { requireContext } from '@/lib/auth/session';
import { canWriteProposals, isManager, one, type SearchParams } from '@/lib/proposals/access';
import { STATUSES, STATUS_LABELS } from '@/lib/proposals/filters';
import { expireOverdue, labelMap, listClientOptions, listProposals, loadPeople, parsePage, personOptions, searchToken } from '@/lib/proposals/data';

export const metadata: Metadata = { title: 'Propostas' };

export default async function ProposalsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const q = searchToken(sp.q);
  const status = (STATUSES as readonly string[]).includes(one(sp.status)) ? one(sp.status) : '';
  const owner = z.uuid().safeParse(one(sp.owner)).success ? one(sp.owner) : null;
  const client = z.uuid().safeParse(one(sp.client)).success ? one(sp.client) : null;
  const archived = one(sp.view) === 'archived';
  const page = parsePage(sp.page);
  await expireOverdue(ctx);
  const [people, clients, { rows, total }] = await Promise.all([loadPeople(ctx), listClientOptions(ctx), listProposals(ctx, { q, status, owner, client, archived, page })]);
  const write = canWriteProposals(ctx.membership.role);
  const manager = isManager(ctx.membership.role);

  return (
    <>
      <PageHeader title="Propostas" description={manager ? 'Todas as propostas da empresa.' : 'Suas propostas.'}>
        <div className="flex flex-wrap gap-2">
          <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href="/export/proposals">Exportar CSV</Link>
          {write ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href="/propostas/nova">Nova proposta</Link> : null}
        </div>
      </PageHeader>
      <ListFilters
        action="/propostas" q={q} placeholder="Número ou título"
        selects={[
          { name: 'status', label: 'Status', value: status, all: 'Todos', options: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })) },
          { name: 'client', label: 'Cliente', value: client ?? '', all: 'Todos', options: clients },
          ...(manager ? [{ name: 'owner', label: 'Responsável', value: owner ?? '', all: 'Todos', options: personOptions(people) }] : []),
          { name: 'view', label: 'Exibir', value: archived ? 'archived' : '', all: 'Ativas', options: [{ value: 'archived', label: 'Arquivadas' }] },
        ]}
      />
      <Card className="p-0">
        <ProposalsTable rows={rows} owners={Object.fromEntries(labelMap(people))} empty={<EmptyState title="Nenhuma proposta" description={q || status || client || owner ? 'Nada encontrado para estes filtros.' : 'Crie a primeira proposta para começar.'} />} />
      </Card>
      <Pagination basePath="/propostas" page={page} total={total} params={{ q, status, client: client ?? '', owner: owner ?? '', view: archived ? 'archived' : '' }} />
    </>
  );
}
