import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ListFilters, Pagination } from '@/components/app/list-bits';
import { ClientsTable } from '@/components/proposals/tables';
import { requireContext } from '@/lib/auth/session';
import { canWriteProposals, one, type SearchParams } from '@/lib/proposals/access';
import { listClients, parsePage, searchToken } from '@/lib/proposals/data';

export const metadata: Metadata = { title: 'Clientes' };

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const q = searchToken(sp.q);
  const archived = one(sp.view) === 'archived';
  const page = parsePage(sp.page);
  const { rows, total } = await listClients(ctx, { q, archived, page });
  const write = canWriteProposals(ctx.membership.role);
  const btn = 'inline-flex min-h-10 items-center rounded-md px-4 text-sm font-medium';

  return (
    <>
      <PageHeader title="Clientes" description="Empresas e pessoas para quem você envia propostas.">
        <div className="flex flex-wrap gap-2">
          <Link className={`${btn} border border-border hover:bg-black/5 dark:hover:bg-white/5`} href="/export/clients">Exportar CSV</Link>
          {write ? <Link className={`${btn} border border-border hover:bg-black/5 dark:hover:bg-white/5`} href="/clientes/importar">Importar CSV</Link> : null}
          {write ? <Link className={`${btn} bg-primary text-primary-foreground hover:opacity-90`} href="/clientes/novo">Novo cliente</Link> : null}
        </div>
      </PageHeader>
      <ListFilters action="/clientes" q={q} placeholder="Nome, razão social ou e-mail" selects={[{ name: 'view', label: 'Exibir', value: archived ? 'archived' : '', all: 'Ativos', options: [{ value: 'archived', label: 'Arquivados' }] }]} />
      <Card className="p-0">
        <ClientsTable rows={rows} empty={<EmptyState title={archived ? 'Nenhum cliente arquivado' : 'Nenhum cliente'} description={q ? 'Nada encontrado para esta busca.' : 'Cadastre o primeiro cliente para criar propostas.'} />} />
      </Card>
      <Pagination basePath="/clientes" page={page} total={total} params={{ q, view: archived ? 'archived' : '' }} />
    </>
  );
}
