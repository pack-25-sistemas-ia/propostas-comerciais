/* eslint-disable @next/next/no-img-element -- logotipo em data URL: a CSP libera img-src data:, e o next/image injeta estilo em linha (bloqueado) */
import type { ReactNode } from 'react';
import { safeHref, isDocEmpty, type PMDoc, type PMNode, type Section } from '@/lib/proposals/content';
import { formatDate, formatDocument, formatMoney, formatQuantity } from '@/lib/proposals/format';
import type { Snapshot } from '@/lib/proposals/snapshot';
import { cn } from '@/lib/utils';

// Renderização do documento da proposta em HTML (prévia do editor, página da proposta e página pública).
// Lê SÓ o Snapshot. O texto é renderizado nó a nó por componentes React: não existe HTML bruto.
// Cores da empresa chegam por variáveis CSS de uma folha do próprio domínio (/p/theme.css), porque a CSP
// bloqueia estilos em linha. Classe: `doc-theme-<primária>-<secundária>` (sem o #).

export const docThemeClass = (primary: string, secondary: string) => `doc-theme-${primary.slice(1).toUpperCase()}-${secondary.slice(1).toUpperCase()}`;
export const docThemeHref = (primary: string, secondary: string) => `/p/theme.css?p=${primary.slice(1).toUpperCase()}&s=${secondary.slice(1).toUpperCase()}`;

// ---------------------------------------------------------------- texto rico
function Inline({ node }: { node: PMNode }): ReactNode {
  if (node.type === 'hardBreak') return <br />;
  if (node.type !== 'text') return null;
  let el: ReactNode = node.text ?? '';
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') el = <strong>{el}</strong>;
    else if (mark.type === 'italic') el = <em>{el}</em>;
    else if (mark.type === 'link') {
      const href = safeHref(mark.attrs?.href);
      if (href) el = <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-[var(--doc-secondary)] underline-offset-2">{el}</a>;
    }
  }
  return el;
}

function Block({ node }: { node: PMNode }): ReactNode {
  const kids = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
      return <p className="mb-3 leading-relaxed">{kids.map((k, i) => <Inline key={i} node={k} />)}</p>;
    case 'heading':
      return node.attrs?.level === 3
        ? <h4 className="mb-2 mt-4 text-sm font-semibold">{kids.map((k, i) => <Inline key={i} node={k} />)}</h4>
        : <h3 className="mb-2 mt-5 text-base font-semibold">{kids.map((k, i) => <Inline key={i} node={k} />)}</h3>;
    case 'bulletList':
      return <ul className="mb-3 list-disc space-y-1 pl-6">{kids.map((k, i) => <Block key={i} node={k} />)}</ul>;
    case 'orderedList':
      return <ol className="mb-3 list-decimal space-y-1 pl-6">{kids.map((k, i) => <Block key={i} node={k} />)}</ol>;
    case 'listItem':
      return <li>{kids.map((k, i) => (k.type === 'paragraph' ? <span key={i} className="block">{(k.content ?? []).map((c, j) => <Inline key={j} node={c} />)}</span> : <Block key={i} node={k} />))}</li>;
    case 'horizontalRule':
      return <hr className="my-4 border-[var(--doc-line)]" />;
    default:
      return null;
  }
}

export function RichText({ doc }: { doc: PMDoc }) {
  return <>{doc.content.map((n, i) => <Block key={i} node={n} />)}</>;
}

// ---------------------------------------------------------------- partes
function PricingTable({ snap, compact }: { snap: Snapshot; compact?: boolean }) {
  const p = snap.pricing;
  const cell = compact ? 'px-2 py-1.5' : 'px-3 py-2';
  return (
    <div className="mb-6 overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">Itens e valores</caption>
        <thead>
          <tr className="border-b-2 border-[var(--doc-primary)] text-left text-xs uppercase tracking-wide text-[var(--doc-muted)]">
            <th scope="col" className={cn(cell, 'font-semibold')}>Item</th>
            <th scope="col" className={cn(cell, 'text-right font-semibold')}>Qtd.</th>
            <th scope="col" className={cn(cell, 'text-right font-semibold')}>Valor unit.</th>
            <th scope="col" className={cn(cell, 'text-right font-semibold')}>Desconto</th>
            <th scope="col" className={cn(cell, 'text-right font-semibold')}>Total</th>
          </tr>
        </thead>
        <tbody>
          {snap.items.map((it, i) => (
            <tr key={i} className="border-b border-[var(--doc-line)] align-top">
              <td className={cell}>
                <div className="font-medium">{it.name}</div>
                {it.description ? <div className="whitespace-pre-line text-xs text-[var(--doc-muted)]">{it.description}</div> : null}
              </td>
              <td className={cn(cell, 'whitespace-nowrap text-right tabular-nums')}>{formatQuantity(it.quantity)} {it.unit}</td>
              <td className={cn(cell, 'whitespace-nowrap text-right tabular-nums')}>{formatMoney(it.unit_price_cents)}</td>
              <td className={cn(cell, 'whitespace-nowrap text-right tabular-nums')}>{it.discount_cents > 0 ? `− ${formatMoney(it.discount_cents)}` : '—'}</td>
              <td className={cn(cell, 'whitespace-nowrap text-right font-medium tabular-nums')}>{formatMoney(it.total_cents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-sm">
          {p.items_discount_cents > 0 ? (
            <tr><td colSpan={4} className={cn(cell, 'text-right text-[var(--doc-muted)]')}>Valor bruto dos itens</td><td className={cn(cell, 'text-right tabular-nums')}>{formatMoney(p.gross_cents)}</td></tr>
          ) : null}
          <tr><td colSpan={4} className={cn(cell, 'text-right text-[var(--doc-muted)]')}>Subtotal</td><td className={cn(cell, 'text-right tabular-nums')}>{formatMoney(p.subtotal_cents)}</td></tr>
          {p.discount.amount_cents > 0 ? (
            <tr>
              <td colSpan={4} className={cn(cell, 'text-right text-[var(--doc-muted)]')}>Desconto{p.discount.kind === 'percent' ? ` (${p.discount.value.toLocaleString('pt-BR')}%)` : ''}</td>
              <td className={cn(cell, 'text-right tabular-nums')}>− {formatMoney(p.discount.amount_cents)}</td>
            </tr>
          ) : null}
          {p.charges.map((c, i) => (
            <tr key={i}>
              <td colSpan={4} className={cn(cell, 'text-right text-[var(--doc-muted)]')}>{c.label}{c.kind === 'percent' ? ` (${c.value.toLocaleString('pt-BR')}%)` : ''}</td>
              <td className={cn(cell, 'text-right tabular-nums')}>+ {formatMoney(c.amount_cents)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-[var(--doc-primary)]">
            <td colSpan={4} className={cn(cell, 'text-right text-base font-semibold')}>Total</td>
            <td className={cn(cell, 'whitespace-nowrap text-right text-base font-bold tabular-nums')}>{formatMoney(p.total_cents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PartyBox({ title, lines }: { title: string; lines: Array<string | null | undefined> }) {
  const shown = lines.filter((l): l is string => Boolean(l));
  return (
    <div className="text-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--doc-muted)]">{title}</p>
      {shown.map((l, i) => <p key={i} className={i === 0 ? 'font-medium' : 'text-[var(--doc-muted)]'}>{l}</p>)}
    </div>
  );
}

function SectionBlock({ section, index, base }: { section: Section; index: number; base: Snapshot['template']['base'] }) {
  return (
    <section className="mb-6 break-inside-avoid-page" aria-label={section.title}>
      {base === 'agency' ? (
        <h2 className="mb-3 flex items-baseline gap-3 text-xl font-bold text-[var(--doc-primary)]">
          <span className="text-sm font-semibold text-[var(--doc-secondary-ink)]">{String(index + 1).padStart(2, '0')}</span>{section.title}
        </h2>
      ) : base === 'technical' ? (
        <h2 className="mb-2 border-b border-[var(--doc-line)] pb-1 text-sm font-bold uppercase tracking-wide text-[var(--doc-primary)]">{section.title}</h2>
      ) : (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--doc-primary)]">{section.title}</h2>
      )}
      <div className="text-sm"><RichText doc={section.content} /></div>
    </section>
  );
}

// ---------------------------------------------------------------- documento
export function DocumentView({ snapshot, className }: { snapshot: Snapshot; className?: string }) {
  const { company, client, proposal, revision, template } = snapshot;
  const base = template.base;
  const visible = snapshot.content.sections.filter((s) => s.enabled && !isDocEmpty(s.content));
  const idxPricing = base === 'technical' ? 0 : (() => { const i = visible.findIndex((s) => s.kind === 'terms' || s.kind === 'closing'); return i === -1 ? visible.length : i; })();

  const header = base === 'agency' ? (
    <header className="mb-8 rounded-lg bg-[var(--doc-primary)] p-6 text-[var(--doc-on-primary)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {company.logo_data_url ? <img src={company.logo_data_url} alt={`Logotipo de ${company.name}`} className="h-12 max-w-40 rounded bg-white/90 object-contain p-1" /> : null}
          <p className="text-lg font-semibold">{company.name}</p>
        </div>
        <p className="text-right text-sm opacity-90">Proposta {proposal.number} · v{revision.version}<br />Emitida em {formatDate(revision.issue_date)}</p>
      </div>
      <h1 className="mt-6 text-3xl font-extrabold leading-tight">{proposal.title}</h1>
      <p className="mt-2 text-sm opacity-90">Preparada para {client.name}{revision.valid_until ? ` · válida até ${formatDate(revision.valid_until)}` : ''}</p>
    </header>
  ) : base === 'technical' ? (
    <header className="mb-5 border-b-2 border-[var(--doc-primary)] pb-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        {company.logo_data_url ? <img src={company.logo_data_url} alt={`Logotipo de ${company.name}`} className="h-10 max-w-32 object-contain" /> : null}
        <div>
          <p className="font-bold">{company.name}</p>
          <p className="text-xs text-[var(--doc-muted)]">{[company.phone, company.email].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="text-right text-sm">
        <p className="text-lg font-bold text-[var(--doc-primary)]">ORÇAMENTO {proposal.number}</p>
        <p className="text-xs text-[var(--doc-muted)]">v{revision.version} · {formatDate(revision.issue_date)}{revision.valid_until ? ` · válido até ${formatDate(revision.valid_until)}` : ''}</p>
      </div>
      </div>
      <h1 className="mt-3 text-xl font-bold">{proposal.title}</h1>
    </header>
  ) : (
    <header className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--doc-line)] pb-5">
        <div className="flex items-center gap-3">
          {company.logo_data_url ? <img src={company.logo_data_url} alt={`Logotipo de ${company.name}`} className="h-12 max-w-40 object-contain" /> : null}
          <p className="text-lg font-semibold text-[var(--doc-primary)]">{company.name}</p>
        </div>
        <p className="text-right text-xs leading-relaxed text-[var(--doc-muted)]">
          <span className="text-sm font-semibold text-[var(--doc-ink)]">Proposta {proposal.number} · v{revision.version}</span><br />
          Emitida em {formatDate(revision.issue_date)}<br />
          {revision.valid_until ? `Válida até ${formatDate(revision.valid_until)}` : null}
        </p>
      </div>
      <h1 className="mt-6 text-3xl font-bold leading-tight text-[var(--doc-primary)]">{proposal.title}</h1>
    </header>
  );

  const parties = (
    <div className={cn('mb-6 grid gap-6 sm:grid-cols-2', base === 'technical' && 'rounded-md border border-[var(--doc-line)] p-3')}>
      <PartyBox title="Cliente" lines={[client.name, client.legal_name && client.legal_name !== client.name ? client.legal_name : null, client.document_number ? formatDocument(client.document_number) : null, client.email, client.phone, client.address]} />
      <PartyBox title="Fornecedor" lines={[company.name, company.legal_name && company.legal_name !== company.name ? company.legal_name : null, company.document_number ? formatDocument(company.document_number) : null, company.email, company.phone, company.address]} />
    </div>
  );

  const pricing = <PricingBlock key="pricing" snapshot={snapshot} />;
  const parts: ReactNode[] = [];
  visible.forEach((s, i) => {
    if (i === idxPricing) parts.push(pricing);
    parts.push(<SectionBlock key={s.id} section={s} index={i} base={base} />);
  });
  if (idxPricing >= visible.length) parts.push(pricing);

  return (
    <article className={cn('doc rounded-lg border border-[var(--doc-line)] bg-white p-6 text-[var(--doc-ink)] shadow-sm sm:p-10', docThemeClass(company.primary_color, company.secondary_color), className)} aria-label={`Proposta ${proposal.number}`}>
      {header}
      {parties}
      {parts}
      <footer className="mt-10 border-t border-[var(--doc-line)] pt-3 text-center text-xs text-[var(--doc-muted)]">
        {company.footer_text ? <p className="whitespace-pre-line">{company.footer_text}</p> : null}
        <p>{[company.legal_name ?? company.name, company.document_number ? formatDocument(company.document_number) : null, company.email, company.phone].filter(Boolean).join(' · ')}</p>
      </footer>
    </article>
  );
}

function PricingBlock({ snapshot }: { snapshot: Snapshot }) {
  const base = snapshot.template.base;
  return (
    <section className="mb-6" aria-label="Investimento">
      <h2 className={cn('mb-3 text-[var(--doc-primary)]', base === 'agency' ? 'text-xl font-bold' : base === 'technical' ? 'border-b border-[var(--doc-line)] pb-1 text-sm font-bold uppercase tracking-wide' : 'text-sm font-semibold uppercase tracking-[0.12em]')}>Investimento</h2>
      <PricingTable snap={snapshot} compact={base === 'technical'} />
    </section>
  );
}
