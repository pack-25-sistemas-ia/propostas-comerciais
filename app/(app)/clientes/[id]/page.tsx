import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ArchiveClientButton, ClientForm } from '@/components/proposals/forms';
import { ProposalsTable } from '@/components/proposals/tables';
import { requireContext } from '@/lib/auth/session';
import { canWriteProposals } from '@/lib/proposals/access';
import { clientSummary, getClient, labelMap, loadPeople } from '@/lib/proposals/data';
import { formatMoney } from '@/lib/proposals/format';

export const metadata: Metadata = { title: 'Cliente' };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const client = await getClient(ctx, id);
  if (!client) notFound();
  const [summary, people] = await Promise.all([clientSummary(ctx, id), loadPeople(ctx)]);
  const write = canWriteProposals(ctx.membership.role);

  return (
    <>
      <PageHeader title={client.name} description={client.archived_at ? 'Cliente arquivado.' : client.legal_name ?? undefined}>
        {write ? (
          <div className="flex flex-wrap gap-2">
            {!client.archived_at ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href={`/propostas/nova?client=${client.id}`}>Nova proposta</Link> : null}
            <ArchiveClientButton id={client.id} archived={Boolean(client.archived_at)} />
          </div>
        ) : null}
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm text-muted">Valor proposto</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(summary.proposedCents)}</p><p className="mt-1 text-xs text-muted">Propostas enviadas (exceto canceladas), na versão vigente.</p></Card>
        <Card><p className="text-sm text-muted">Valor aceito</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(summary.acceptedCents)}</p><p className="mt-1 text-xs text-muted">{summary.acceptedCount} proposta(s) aceita(s).</p></Card>
        <Card><p className="text-sm text-muted">Propostas</p><p className="mt-1 text-2xl font-semibold tabular-nums">{summary.proposals.length}</p><p className="mt-1 text-xs text-muted">Inclui rascunhos.</p></Card>
      </div>

      <div className="grid gap-6">
        <Card title="Propostas deste cliente">
          <div className="-mx-2">
            <ProposalsTable rows={summary.proposals} owners={Object.fromEntries(labelMap(people))} empty={<EmptyState title="Nenhuma proposta ainda" description="Crie a primeira proposta para este cliente." />} />
          </div>
        </Card>
        {write ? <Card title="Dados do cliente"><ClientForm client={client} /></Card> : (
          <Card title="Dados do cliente">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">E-mail</dt><dd>{client.email ?? '—'}</dd></div>
              <div><dt className="text-muted">Telefone</dt><dd>{client.phone ?? '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted">Endereço</dt><dd>{client.address ?? '—'}</dd></div>
            </dl>
          </Card>
        )}
      </div>
    </>
  );
}
