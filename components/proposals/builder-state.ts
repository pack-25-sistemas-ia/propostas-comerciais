// Estado do construtor de propostas e conversão a partir das linhas do banco. Módulo SEM 'use client': a página
// (servidor) monta o estado inicial e o passa como propriedade ao componente do navegador.
import { sanitizeContent, type Section } from '@/lib/proposals/content';
import { centsToInput } from '@/lib/proposals/format';

let seq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

export type BuilderClient = { id: string; name: string; type: 'company' | 'person'; legal_name: string | null; document_number: string | null; email: string | null; phone: string | null; address: string | null };
export type BuilderItem = {
  key: string; catalog_item_id: string | null; item_type: 'product' | 'service'; name: string; description: string; unit: string; quantity: string; price: string;
  discount_kind: 'none' | 'percent' | 'fixed'; discount_value: string;
};
export type BuilderCharge = { key: string; label: string; kind: 'percent' | 'fixed'; value: string };
export type BuilderState = {
  title: string; clientId: string; templateId: string; issueDate: string; validUntil: string;
  discountKind: 'none' | 'percent' | 'fixed'; discountValue: string; charges: BuilderCharge[]; items: BuilderItem[]; sections: Section[];
};

/** Estado inicial do construtor a partir das linhas do banco. */
export function initialBuilderState(a: {
  title: string; clientId: string; templateId: string | null; issueDate: string; validUntil: string | null;
  discountKind: BuilderState['discountKind']; discountValue: number | string; charges: Array<{ label: string; kind: 'percent' | 'fixed'; value: number | string }>;
  items: Array<{ catalog_item_id: string | null; item_type: 'product' | 'service'; name: string; description: string | null; unit: string; quantity: number | string; unit_price_cents: number; discount_kind: 'none' | 'percent' | 'fixed'; discount_value: number | string }>;
  content: unknown; defaultTemplateId: string;
}): BuilderState {
  const amount = (kind: 'none' | 'percent' | 'fixed', v: number | string) => (kind === 'none' ? '' : kind === 'percent' ? String(Number(v)).replace('.', ',') : centsToInput(Number(v)));
  return {
    title: a.title, clientId: a.clientId, templateId: a.templateId ?? a.defaultTemplateId, issueDate: a.issueDate, validUntil: a.validUntil ?? '',
    discountKind: a.discountKind, discountValue: amount(a.discountKind, a.discountValue),
    charges: a.charges.map((c) => ({ key: newKey(), label: c.label, kind: c.kind, value: amount(c.kind, c.value) })),
    items: a.items.map((i) => ({
      key: newKey(), catalog_item_id: i.catalog_item_id, item_type: i.item_type, name: i.name, description: i.description ?? '', unit: i.unit,
      quantity: String(Number(i.quantity)).replace('.', ','), price: centsToInput(i.unit_price_cents), discount_kind: i.discount_kind, discount_value: amount(i.discount_kind, i.discount_value),
    })),
    sections: sanitizeContent(a.content).sections,
  };
}

