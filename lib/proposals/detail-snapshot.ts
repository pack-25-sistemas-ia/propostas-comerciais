import 'server-only';
import type { Context } from '@/lib/auth/session';
import { loadSettings, loadTemplates, type ProposalDetail } from './data';
import { buildDraftSnapshot } from './draft-snapshot';
import { parseSnapshot, type Snapshot } from './snapshot';

export type RevisionDocument =
  | { ok: true; snapshot: Snapshot; draft: boolean }
  | { ok: false; error: string; status: 404 | 422 | 500 };

/**
 * Documento da revisão selecionada. Publicada: snapshot imutável do banco. Rascunho: montado do estado salvo
 * (provisório). Rascunho incompleto devolve o motivo em vez de um documento enganoso.
 */
export async function documentForRevision(ctx: Context, detail: ProposalDetail): Promise<RevisionDocument> {
  const { proposal, current, client, items } = detail;
  if (!current) return { ok: false, error: 'Revisão não encontrada.', status: 404 };
  if (current.published_at) {
    let raw = current.snapshot_json;
    if (raw === undefined) {
      const { data } = await ctx.supabase.from('proposal_revisions').select('snapshot_json').eq('id', current.id).maybeSingle();
      raw = (data as { snapshot_json: unknown } | null)?.snapshot_json;
    }
    const snapshot = parseSnapshot(raw);
    return snapshot ? { ok: true, snapshot, draft: false } : { ok: false, error: 'O documento desta revisão está indisponível.', status: 500 };
  }
  if (!client) return { ok: false, error: 'Proposta incompleta: cliente não encontrado.', status: 422 };
  if (items.length === 0) return { ok: false, error: 'Proposta incompleta: adicione ao menos um item antes de gerar o documento.', status: 422 };
  const [settings, templates] = await Promise.all([loadSettings(ctx), loadTemplates(ctx)]);
  const tpl = templates.find((t) => t.id === current.template_id) ?? templates.find((t) => t.is_default) ?? templates[0];
  const built = buildDraftSnapshot({
    number: proposal.proposal_number, title: proposal.title, version: current.version_number, issueDate: current.issue_date, validUntil: current.valid_until,
    templateBase: tpl?.base ?? 'corporate', templateName: tpl?.name ?? null, content: current.content_json,
    items: items.map((i) => ({ item_type: i.item_type, name: i.name, description: i.description, unit: i.unit, quantity: String(i.quantity), unit_price_cents: i.unit_price_cents, discount_kind: i.discount_kind, discount_value: String(i.discount_value) })),
    discount: { kind: current.discount_kind, value: String(current.discount_value) },
    charges: current.charges.map((c) => ({ label: c.label, kind: c.kind, value: String(c.value) })),
    company: {
      name: ctx.membership.name, legal_name: settings.legal_name, document_number: settings.document_number, email: settings.email, phone: settings.phone, address: settings.address,
      footer_text: settings.footer_text, primary_color: settings.primary_color, secondary_color: settings.secondary_color, logo_data_url: settings.logo_data_url,
    },
    client: { type: client.type, name: client.name, legal_name: client.legal_name, document_number: client.document_number, email: client.email, phone: client.phone, address: client.address },
  });
  return built.ok ? { ok: true, snapshot: built.snapshot, draft: true } : { ok: false, error: `Proposta incompleta: ${built.error}`, status: 422 };
}
