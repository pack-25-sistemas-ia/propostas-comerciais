import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ProposalCreateForm } from '@/components/proposals/forms';
import { requireContext } from '@/lib/auth/session';
import { WRITER_ROLES, one, type SearchParams } from '@/lib/proposals/access';
import { listClientOptions, loadTemplates } from '@/lib/proposals/data';

export const metadata: Metadata = { title: 'Nova proposta' };

export default async function NewProposalPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext(WRITER_ROLES);
  const sp = await searchParams;
  const [clients, templates] = await Promise.all([listClientOptions(ctx), loadTemplates(ctx)]);
  const wanted = one(sp.client);
  const defaultClient = z.uuid().safeParse(wanted).success && clients.some((c) => c.value === wanted) ? wanted : undefined;
  const defaultTemplate = templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? '';

  return (
    <>
      <PageHeader title="Nova proposta" description="Escolha o cliente e o modelo. Depois você monta itens, valores e texto no editor." />
      {clients.length === 0 ? (
        <EmptyState title="Cadastre um cliente primeiro" description="Toda proposta é para um cliente.">
          <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href="/clientes/novo">Novo cliente</Link>
        </EmptyState>
      ) : (
        <Card><ProposalCreateForm clients={clients} templates={templates.map((t) => ({ value: t.id, label: t.name }))} defaultTemplate={defaultTemplate} defaultClient={defaultClient} /></Card>
      )}
    </>
  );
}
