// Snapshot PROVISÓRIO de um rascunho, para prévia na tela e PDF de rascunho. Não é gravado em lugar nenhum:
// ao publicar, o BANCO monta o snapshot definitivo (função prop_publish_revision). Os valores aqui usam o espelho
// TypeScript do motor de cálculo (as duas implementações são testadas com as mesmas fixtures).
import { sanitizeContent, type ProposalContent } from './content';
import { computePricing, PricingError, type PricingChargeInput, type PricingDiscountInput, type PricingItemInput } from './pricing';
import type { Snapshot, TemplateBase } from './snapshot';

export type DraftState = {
  number: string;
  title: string;
  version: number;
  issueDate: string;
  validUntil: string | null;
  templateBase: TemplateBase;
  templateName: string | null;
  content: ProposalContent | unknown;
  items: Array<{
    item_type: 'product' | 'service'; name: string; description: string | null; unit: string; quantity: string; unit_price_cents: number;
    discount_kind: 'none' | 'percent' | 'fixed'; discount_value: string;
  }>;
  discount: PricingDiscountInput;
  charges: PricingChargeInput[];
  company: Snapshot['company'];
  client: Snapshot['client'];
};

export type DraftSnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; error: string };

export function buildDraftSnapshot(d: DraftState): DraftSnapshotResult {
  let result;
  try {
    const items: PricingItemInput[] = d.items.map((i) => ({ quantity: i.quantity, unit_price_cents: i.unit_price_cents, discount_kind: i.discount_kind, discount_value: i.discount_value }));
    result = computePricing(items, d.discount, d.charges);
  } catch (e) {
    return { ok: false, error: e instanceof PricingError ? e.message : 'Valores inválidos.' };
  }
  return {
    ok: true,
    snapshot: {
      proposal: { number: d.number, title: d.title, currency: 'BRL' },
      revision: { version: d.version, issue_date: d.issueDate, valid_until: d.validUntil },
      company: d.company,
      client: d.client,
      template: { base: d.templateBase, name: d.templateName },
      content: sanitizeContent(d.content),
      items: d.items.map((i, n) => ({
        item_type: i.item_type, name: i.name, description: i.description, unit: i.unit, quantity: Number(i.quantity), unit_price_cents: i.unit_price_cents,
        discount_kind: i.discount_kind, discount_value: Number(i.discount_value), gross_cents: result.items[n]!.gross_cents,
        discount_cents: result.items[n]!.discount_cents, total_cents: result.items[n]!.total_cents,
      })),
      pricing: {
        gross_cents: result.gross_cents, items_discount_cents: result.items_discount_cents, subtotal_cents: result.subtotal_cents,
        discount: { kind: d.discount.kind, value: Number(d.discount.value), amount_cents: result.discount_cents },
        charges: result.charges, total_cents: result.total_cents,
      },
    },
  };
}
