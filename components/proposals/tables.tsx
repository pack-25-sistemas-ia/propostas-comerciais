'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/app/data-table';
import { formatDateBR, formatDocument, formatMoney } from '@/lib/proposals/format';
import { CLIENT_TYPE_LABELS } from '@/lib/proposals/validation';
import type { CatalogRow, ClientRow, ProposalListItem } from '@/lib/proposals/data';
import { StatusBadge } from './status-badge';

const dash = <span className="text-muted">—</span>;

export function ClientsTable({ rows, empty }: { rows: ClientRow[]; empty: React.ReactNode }) {
  const columns: ColumnDef<ClientRow, unknown>[] = [
    { accessorKey: 'name', header: 'Cliente', cell: ({ row }) => <Link className="font-medium underline-offset-2 hover:underline" href={`/clientes/${row.original.id}`}>{row.original.name}</Link> },
    { accessorKey: 'type', header: 'Tipo', cell: ({ row }) => CLIENT_TYPE_LABELS[row.original.type] },
    { accessorKey: 'document_number', header: 'CPF/CNPJ', cell: ({ row }) => (row.original.document_number ? <span className="whitespace-nowrap">{formatDocument(row.original.document_number)}</span> : dash) },
    { id: 'contact', header: 'Contato', enableSorting: false, cell: ({ row }) => <div className="text-xs"><div>{row.original.email ?? dash}</div><div className="text-muted">{row.original.phone ?? ''}</div></div> },
    { accessorKey: 'created_at', header: 'Cadastro', cell: ({ getValue }) => <span className="whitespace-nowrap text-muted">{formatDateBR(getValue() as string)}</span> },
  ];
  return <DataTable columns={columns} data={rows} caption="Clientes" empty={empty} />;
}

export function CatalogTable({ rows, empty, canEdit }: { rows: CatalogRow[]; empty: React.ReactNode; canEdit: boolean }) {
  const columns: ColumnDef<CatalogRow, unknown>[] = [
    { accessorKey: 'name', header: 'Item', cell: ({ row }) => (canEdit ? <Link className="font-medium hover:underline" href={`/catalogo/${row.original.id}`}>{row.original.name}</Link> : <span className="font-medium">{row.original.name}</span>) },
    { accessorKey: 'sku', header: 'Código', cell: ({ getValue }) => (getValue() as string | null) ?? dash },
    { accessorKey: 'type', header: 'Tipo', cell: ({ row }) => (row.original.type === 'product' ? 'Produto' : 'Serviço') },
    { accessorKey: 'unit', header: 'Unidade' },
    { accessorKey: 'default_price_cents', header: 'Preço padrão', cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'active', header: 'Situação', cell: ({ row }) => <Badge tone={row.original.active ? 'success' : 'neutral'}>{row.original.active ? 'Ativo' : 'Inativo'}</Badge> },
    { accessorKey: 'updated_at', header: 'Atualizado', cell: ({ getValue }) => <span className="whitespace-nowrap text-muted">{formatDateBR(getValue() as string)}</span> },
  ];
  return <DataTable columns={columns} data={rows} caption="Catálogo de produtos e serviços" empty={empty} />;
}

export function ProposalsTable({ rows, owners, empty }: { rows: ProposalListItem[]; owners: Record<string, string>; empty: React.ReactNode }) {
  const columns: ColumnDef<ProposalListItem, unknown>[] = [
    { accessorKey: 'proposal_number', header: 'Nº', cell: ({ row }) => <Link className="font-medium tabular-nums underline-offset-2 hover:underline" href={`/propostas/${row.original.id}`}>{row.original.proposal_number}</Link> },
    { accessorKey: 'title', header: 'Título', cell: ({ row }) => <span className="font-medium">{row.original.title}</span> },
    { accessorKey: 'client_name', header: 'Cliente' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { accessorKey: 'total_cents', header: 'Valor', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatMoney(row.original.total_cents)}{row.original.version ? <span className="ml-1 text-xs text-muted">v{row.original.version}</span> : null}</span> },
    { id: 'owner', header: 'Responsável', accessorFn: (r) => (r.owner_id ? owners[r.owner_id] ?? '' : ''), cell: ({ getValue }) => (getValue() as string) || dash },
    { accessorKey: 'created_at', header: 'Criada em', cell: ({ getValue }) => <span className="whitespace-nowrap text-muted">{formatDateBR(getValue() as string)}</span> },
  ];
  return <DataTable columns={columns} data={rows} caption="Propostas" empty={empty} />;
}
