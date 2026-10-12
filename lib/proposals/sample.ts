import { sanitizeContent } from './content';
import type { Snapshot, TemplateBase } from './snapshot';

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const li = (text: string) => ({ type: 'listItem', content: [p(text)] });

/** Documento de EXEMPLO (texto fictício) para mostrar a aparência de cada modelo na tela de modelos. Nunca é gravado. */
export function sampleSnapshot(base: TemplateBase, name: string, company: Snapshot['company']): Snapshot {
  const items = [
    { item_type: 'service' as const, name: 'Diagnóstico e planejamento', description: 'Levantamento das necessidades e plano de trabalho.', unit: 'h', quantity: 20, unit_price_cents: 18000, discount_kind: 'none' as const, discount_value: 0, gross_cents: 360000, discount_cents: 0, total_cents: 360000 },
    { item_type: 'service' as const, name: 'Implantação', description: null, unit: 'h', quantity: 40, unit_price_cents: 15000, discount_kind: 'percent' as const, discount_value: 10, gross_cents: 600000, discount_cents: 60000, total_cents: 540000 },
    { item_type: 'product' as const, name: 'Licença anual', description: null, unit: 'un', quantity: 1, unit_price_cents: 120000, discount_kind: 'none' as const, discount_value: 0, gross_cents: 120000, discount_cents: 0, total_cents: 120000 },
  ];
  return {
    proposal: { number: '00000', title: 'Exemplo de proposta', currency: 'BRL' },
    revision: { version: 1, issue_date: '2026-01-15', valid_until: '2026-02-14' },
    company,
    client: { type: 'company', name: 'Cliente Exemplo Ltda', legal_name: null, document_number: null, email: 'contato@cliente-exemplo.invalid', phone: null, address: null },
    template: { base, name },
    content: sanitizeContent({
      sections: [
        { id: 'a', kind: 'presentation', title: base === 'agency' ? 'Quem somos' : 'Apresentação', content: { type: 'doc', content: [p('Texto de exemplo: apresente sua empresa e o contexto da proposta em poucas linhas.')] } },
        { id: 'b', kind: 'scope', title: base === 'technical' ? 'Descrição dos serviços' : 'Escopo', content: { type: 'doc', content: [p('O escopo inclui:'), { type: 'bulletList', content: [li('Diagnóstico inicial'), li('Implantação assistida'), li('Treinamento da equipe')] }] } },
        { id: 'c', kind: 'terms', title: 'Condições comerciais', content: { type: 'doc', content: [p('Pagamento em 30 dias após o aceite. Validade da proposta conforme indicado.')] } },
      ],
    }),
    items,
    pricing: { gross_cents: 1080000, items_discount_cents: 60000, subtotal_cents: 1020000, discount: { kind: 'none', value: 0, amount_cents: 0 }, charges: [], total_cents: 1020000 },
  };
}
