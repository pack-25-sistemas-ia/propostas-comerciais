import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { CatalogForm } from '@/components/proposals/forms';
import { ListFilters, Pagination } from '@/components/app/list-bits';
import { CatalogTable } from '@/components/proposals/tables';
import { requireContext } from '@/lib/auth/session';
import { isManager, one, type SearchParams } from '@/lib/proposals/access';
import { listCatalog, parsePage, searchToken } from '@/lib/proposals/data';

export const metadata: Metadata = { title: 'Catálogo' };

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const q = searchToken(sp.q);
  const type = ['product', 'service'].includes(one(sp.type)) ? one(sp.type) : '';
  const status = ['active', 'inactive'].includes(one(sp.status)) ? one(sp.status) : '';
  const page = parsePage(sp.page);
  const { rows, total } = await listCatalog(ctx, { q, type, status, page });
  const manage = isManager(ctx.membership.role);

  return (
    <>
      <PageHeader title="Catálogo" description="Produtos e serviços com preço padrão. Ao entrar numa proposta, o item é COPIADO: mudar o catálogo depois não altera propostas já publicadas." />
      {manage ? (
        <details className="mb-6 rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer font-medium">Novo item</summary>
          <div className="mt-4"><CatalogForm /></div>
        </details>
      ) : null}
      <ListFilters
        action="/catalogo" q={q} placeholder="Nome, código ou descrição"
        selects={[
          { name: 'type', label: 'Tipo', value: type, all: 'Todos', options: [{ value: 'product', label: 'Produto' }, { value: 'service', label: 'Serviço' }] },
          { name: 'status', label: 'Situação', value: status, all: 'Todas', options: [{ value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }] },
        ]}
      />
      <Card className="p-0">
        <CatalogTable rows={rows} canEdit={manage} empty={<EmptyState title="Nenhum item" description={q || type || status ? 'Nada encontrado para estes filtros.' : 'Cadastre produtos e serviços para montar propostas mais rápido.'} />} />
      </Card>
      <Pagination basePath="/catalogo" page={page} total={total} params={{ q, type, status }} />
    </>
  );
}
