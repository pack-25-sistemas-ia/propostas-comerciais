'use client';

import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabela com ordenação por coluna (TanStack Table). Busca, filtros e paginação são feitos no servidor
 * (parâmetros da URL), então a ordenação aqui vale para a página exibida.
 */
export function DataTable<T>({ columns, data, caption, empty }: { columns: ColumnDef<T, unknown>[]; data: T[]; caption: string; empty?: React.ReactNode }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  // O React Compiler não memoiza este componente por causa da API do TanStack Table (comportamento esperado e correto).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  if (data.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border text-muted">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sortable = h.column.getCanSort();
                const dir = h.column.getIsSorted();
                return (
                  <th key={h.id} scope="col" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined} className="px-4 py-3 font-medium">
                    {h.isPlaceholder ? null : sortable ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn('inline-flex items-center gap-1 rounded hover:underline', dir && 'text-foreground')}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <span aria-hidden="true">{dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : ''}</span>
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 align-top">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
