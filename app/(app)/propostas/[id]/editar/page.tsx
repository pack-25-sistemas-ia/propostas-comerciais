import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { ProposalBuilder } from '@/components/proposals/builder';
import { initialBuilderState } from '@/components/proposals/builder-state';
import { requireContext } from '@/lib/auth/session';
import { WRITER_ROLES } from '@/lib/proposals/access';
import { getProposal, listActiveCatalog, loadSettings, loadTemplates, type ClientRow } from '@/lib/proposals/data';

export const metadata: Metadata = { title: 'Editar proposta' };

export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(WRITER_ROLES);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getProposal(ctx, id);
  if (!detail || !detail.current) notFound();
  const { proposal, current, items } = detail;
  // revisão publicada é imutável: o caminho é criar uma nova revisão
  if (current.published_at || proposal.archived_at || proposal.status === 'accepted' || proposal.status === 'cancelled') redirect(`/propostas/${id}`);

  const org = ctx.membership.organization_id;
  const [settings, templates, catalog, clientsRes] = await Promise.all([
    loadSettings(ctx),
    loadTemplates(ctx),
    listActiveCatalog(ctx),
    ctx.supabase.from('clients').select('id, name, type, legal_name, document_number, email, phone, address').eq('organization_id', org).is('archived_at', null).order('name').limit(1000),
  ]);
  const clients = (clientsRes.data ?? []) as Array<Pick<ClientRow, 'id' | 'name' | 'type' | 'legal_name' | 'document_number' | 'email' | 'phone' | 'address'>>;
  // o cliente da proposta precisa estar na lista mesmo se foi arquivado depois
  if (!clients.some((c) => c.id === proposal.client_id) && detail.client) clients.unshift(detail.client);
  const defaultTemplateId = templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? '';
  const role = ctx.membership.role;
  const limitPct = role === 'member' ? settings.max_discount_member_pct : role === 'manager' ? settings.max_discount_manager_pct : null;

  return (
    <ProposalBuilder
      proposalId={proposal.id}
      number={proposal.proposal_number}
      status={proposal.status}
      version={current.version_number}
      revisionId={current.id}
      clients={clients}
      templates={templates.map((t) => ({ id: t.id, name: t.name, base: t.base }))}
      catalog={catalog}
      limitPct={limitPct}
      company={{
        name: ctx.membership.name, legal_name: settings.legal_name, document_number: settings.document_number, email: settings.email, phone: settings.phone, address: settings.address,
        footer_text: settings.footer_text, primary_color: settings.primary_color, secondary_color: settings.secondary_color, logo_data_url: settings.logo_data_url,
      }}
      initial={initialBuilderState({
        title: proposal.title, clientId: proposal.client_id, templateId: current.template_id, issueDate: current.issue_date, validUntil: current.valid_until,
        discountKind: current.discount_kind, discountValue: current.discount_value, charges: current.charges, items, content: current.content_json, defaultTemplateId,
      })}
    />
  );
}
