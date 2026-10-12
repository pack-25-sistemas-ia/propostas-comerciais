import Link from 'next/link';
import { Button, Input, Select } from '@/components/ui/primitives';
import { PAGE_SIZE } from '@/lib/proposals/data';

/** Busca e filtros via GET (URL compartilhável, funciona sem JavaScript). */
export function ListFilters({
  action, q, placeholder = 'Buscar…', selects = [], hidden = {}, search = true,
}: {
  action: string;
  q: string;
  /** false: esconde o campo de busca (páginas sem busca por texto). */
  search?: boolean;
  placeholder?: string;
  selects?: Array<{ name: string; label: string; value: string; options: Array<{ value: string; label: string }>; all: string }>;
  hidden?: Record<string, string>;
}) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {search ? (
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-muted">Busca</label>
          <Input id="q" name="q" defaultValue={q} placeholder={placeholder} maxLength={60} />
        </div>
      ) : null}
      {selects.map((s) => (
        <div key={s.name}>
          <label htmlFor={`f-${s.name}`} className="mb-1 block text-xs font-medium text-muted">{s.label}</label>
          <Select id={`f-${s.name}`} name={s.name} defaultValue={s.value} className="w-44">
            <option value="">{s.all}</option>
            {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      ))}
      <Button type="submit" variant="secondary">Filtrar</Button>
    </form>
  );
}

export function Pagination({ basePath, page, total, params }: { basePath: string; page: number; total: number; params: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav aria-label="Paginação" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <p className="text-muted">{total === 0 ? 'Nenhum registro' : `${total.toLocaleString('pt-BR')} registro(s) · página ${page} de ${pages}`}</p>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-border px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5" href={href(page - 1)}>Anterior</Link> : null}
        {page < pages ? <Link className="rounded-md border border-border px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5" href={href(page + 1)}>Próxima</Link> : null}
      </div>
    </nav>
  );
}
