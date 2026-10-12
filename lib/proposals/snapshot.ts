// Snapshot da revisão publicada: tudo que o documento precisa (empresa, cliente, itens, valores, texto, modelo),
// gravado no momento da publicação. Tela e PDF leem SÓ daqui, por isso a revisão se reproduz idêntica para sempre,
// mesmo que catálogo, cliente ou configurações mudem depois.
// `parseSnapshot` é defensivo: o conteúdo é sanitizado de novo e cores/logotipo são validados antes de renderizar.
import { z } from 'zod';
import { sanitizeContent, type ProposalContent } from './content';

export type TemplateBase = 'corporate' | 'agency' | 'technical';

export type Snapshot = {
  proposal: { number: string; title: string; currency: 'BRL' };
  revision: { version: number; issue_date: string; valid_until: string | null };
  company: {
    name: string; legal_name: string | null; document_number: string | null; email: string | null; phone: string | null; address: string | null;
    footer_text: string | null; primary_color: string; secondary_color: string; logo_data_url: string | null;
  };
  client: { type: 'company' | 'person'; name: string; legal_name: string | null; document_number: string | null; email: string | null; phone: string | null; address: string | null };
  template: { base: TemplateBase; name: string | null };
  content: ProposalContent;
  items: Array<{
    item_type: 'product' | 'service'; name: string; description: string | null; unit: string; quantity: number; unit_price_cents: number;
    discount_kind: 'none' | 'percent' | 'fixed'; discount_value: number; gross_cents: number; discount_cents: number; total_cents: number;
  }>;
  pricing: {
    gross_cents: number; items_discount_cents: number; subtotal_cents: number;
    discount: { kind: 'none' | 'percent' | 'fixed'; value: number; amount_cents: number };
    charges: Array<{ label: string; kind: 'percent' | 'fixed'; value: number; amount_cents: number }>;
    total_cents: number;
  };
};

const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const nullableText = (max: number) => z.string().max(max).nullable().catch(null);
const cents = z.coerce.number().int().min(0).max(99_999_999_999);
const logo = z.string().max(420_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/).nullable().catch(null);
const kind = z.enum(['none', 'percent', 'fixed']);

const schema = z.object({
  proposal: z.object({ number: z.string().max(40), title: z.string().max(200) }),
  revision: z.object({ version: z.number().int().min(1), issue_date: z.string().max(10), valid_until: z.string().max(10).nullable().catch(null) }),
  company: z.object({
    name: z.string().max(160), legal_name: nullableText(160), document_number: nullableText(20), email: nullableText(254), phone: nullableText(30),
    address: nullableText(300), footer_text: nullableText(400), primary_color: color.catch('#162A43'), secondary_color: color.catch('#22D3EE'), logo_data_url: logo,
  }),
  client: z.object({
    type: z.enum(['company', 'person']).catch('company'), name: z.string().max(160), legal_name: nullableText(160), document_number: nullableText(20),
    email: nullableText(254), phone: nullableText(30), address: nullableText(300),
  }),
  template: z.object({ base: z.enum(['corporate', 'agency', 'technical']).catch('corporate'), name: nullableText(80) }),
  content: z.unknown(),
  items: z.array(z.object({
    item_type: z.enum(['product', 'service']).catch('service'), name: z.string().max(160), description: nullableText(2000), unit: z.string().max(20),
    quantity: z.coerce.number().positive(), unit_price_cents: cents, discount_kind: kind.catch('none'), discount_value: z.coerce.number().min(0).catch(0),
    gross_cents: cents, discount_cents: cents, total_cents: cents,
  })).max(200),
  pricing: z.object({
    gross_cents: cents, items_discount_cents: cents, subtotal_cents: cents,
    discount: z.object({ kind: kind.catch('none'), value: z.coerce.number().min(0).catch(0), amount_cents: cents }),
    charges: z.array(z.object({ label: z.string().max(60), kind: z.enum(['percent', 'fixed']), value: z.coerce.number().min(0), amount_cents: cents })).max(10),
    total_cents: cents,
  }),
});

/** Snapshot confiável para renderização; `null` se estiver malformado. */
export function parseSnapshot(raw: unknown): Snapshot | null {
  const r = schema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  return { ...d, proposal: { ...d.proposal, currency: 'BRL' }, content: sanitizeContent(d.content) };
}
