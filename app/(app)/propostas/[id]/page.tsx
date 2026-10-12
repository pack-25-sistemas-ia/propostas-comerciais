import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { DocumentView, docThemeHref } from '@/components/proposals/document-view';
import { ProposalActions } from '@/components/proposals/proposal-actions';
import { SharePanel } from '@/components/proposals/share-panel';
import { StatusBadge } from '@/components/proposals/status-badge';
import { Timeline } from '@/components/proposals/timeline';
import { requireContext } from '@/lib/auth/session';
import { canWriteProposals, one, type SearchParams } from '@/lib/proposals/access';
import { getProposal, labelMap, loadPeople } from '@/lib/proposals/data';
import { documentForRevision } from '@/lib/proposals/detail-snapshot';
import { formatDate, formatDateTimeBR, formatMoney } from '@/lib/proposals/format';
import { nowIso } from '@/lib/time';

export const metadata: Metadata = { title: 'Proposta' };

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireContext();
  const { id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const wanted = z.uuid().safeParse(one(sp.rev)).success ? one(sp.rev) : null;
  const detail = await getProposal(ctx, id, wanted);
  if (!detail || !detail.current) notFound();
  const { proposal, client, revisions, current, events, links, decisions, emails } = detail;
  const people = await loadPeople(ctx);
  const doc = await documentForRevision(ctx, detail);
  const write = canWriteProposals(ctx.membership.role);
  const latest = revisions[0];
  const draftRevision = Boolean(latest && !latest.published_at);
  const shareable = proposal.status === 'sent' || proposal.status === 'viewed';
  const published = one(sp.published) === '1';
  const decisionOf = (revId: string) => decisions.find((d) => d.revision_id === revId);
  const owner = proposal.owner_id ? labelMap(people).get(proposal.owner_id) : null;

  return (
    <>
      <PageHeader title={`Proposta ${proposal.proposal_number}`} description={proposal.title}>
        <StatusBadge status={proposal.status} />
      </PageHeader>
      {published ? <div className="mb-4"><Alert tone="success">Proposta publicada. Esta versão está congelada. Gere o link abaixo para enviar ao cliente.</Alert></div> : null}
      {proposal.archived_at ? <div className="mb-4"><Alert tone="info">Proposta arquivada: não aparece nas listas nem nos indicadores.</Alert></div> : null}

      <div className="mb-6"><ProposalActions proposalId={proposal.id} status={proposal.status} canWrite={write} draftRevision={draftRevision} archived={Boolean(proposal.archived_at)} revisionId={current.id} /></div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><p className="text-sm text-muted">Valor (versão {current.version_number})</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(current.total_cents)}</p></Card>
        <Card><p className="text-sm text-muted">Cliente</p><p className="mt-1 font-medium">{client ? <Link className="hover:underline" href={`/clientes/${client.id}`}>{client.name}</Link> : '—'}</p></Card>
        <Card><p className="text-sm text-muted">Válida até</p><p className="mt-1 font-medium">{formatDate(current.valid_until)}</p><p className="text-xs text-muted">Emitida em {formatDate(current.issue_date)}</p></Card>
        <Card><p className="text-sm text-muted">Responsável</p><p className="mt-1 font-medium">{owner ?? '—'}</p><p className="text-xs text-muted">Primeiro envio: {proposal.first_sent_at ? formatDateTimeBR(proposal.first_sent_at) : '—'}</p></Card>
      </div>

      {decisions.length > 0 ? (
        <div className="mb-6 space-y-3">
          {decisions.map((d) => (
            <Alert key={d.id} tone={d.decision === 'accepted' ? 'success' : 'warning'}>
              <strong>{d.decision === 'accepted' ? 'Aceita' : 'Recusada'}</strong> pelo cliente em {formatDateTimeBR(d.created_at)} — {d.client_name} ({d.client_email}){d.comment ? ` · “${d.comment}”` : ''}. Confirmação comercial simples, sem valor de assinatura eletrônica certificada.
            </Alert>
          ))}
        </div>
      ) : null}

      <div className="mb-6"><SharePanel proposalId={proposal.id} canShare={write} shareable={shareable} publishedRevisionId={proposal.published_revision_id} links={links} emails={emails} defaultEmail={client?.email ?? ''} nowIso={nowIso()} /></div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Documento">
          {!doc.ok ? <Alert tone="info">{doc.error}</Alert> : (
            <>
              <link rel="stylesheet" href={docThemeHref(doc.snapshot.company.primary_color, doc.snapshot.company.secondary_color)} precedence="doc-theme" />
              {doc.draft ? <div className="mb-3"><Alert tone="warning">Rascunho: esta é uma prévia do que será publicado.</Alert></div> : null}
              <DocumentView snapshot={doc.snapshot} />
            </>
          )}
        </section>
        <aside className="space-y-6">
          <Card title="Versões">
            <ol className="space-y-2 text-sm">
              {revisions.map((r) => {
                const d = decisionOf(r.id);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-1">
                    <Link className={`hover:underline ${r.id === current.id ? 'font-semibold' : ''}`} href={`/propostas/${proposal.id}?rev=${r.id}`}>Versão {r.version_number}</Link>
                    <span className="text-xs text-muted">
                      {r.published_at ? `publicada em ${formatDate(r.published_at.slice(0, 10))}` : 'rascunho'} · {formatMoney(r.total_cents)}{d ? ` · ${d.decision === 'accepted' ? 'aceita' : 'recusada'}` : ''}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
          <Card title="Histórico"><Timeline events={events} /></Card>
        </aside>
      </div>
    </>
  );
}
