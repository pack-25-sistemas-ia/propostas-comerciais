import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { computePricing } from '@/lib/proposals/pricing';
import { pdfText } from '@/lib/proposals/pdf/document';
import { pdfFileName, renderProposalPdf } from '@/lib/proposals/pdf/render';
import { sampleSnapshot } from '@/lib/proposals/sample';
import { sanitizeContent } from '@/lib/proposals/content';
import type { Snapshot, TemplateBase } from '@/lib/proposals/snapshot';

// PDF A4 gerado do snapshot: conteúdo, valores, acentos, paginação, rodapé e segurança (links) são conferidos
// LENDO o PDF de volta (pdf.js), não só olhando se "gerou um arquivo".

const COMPANY: Snapshot['company'] = {
  name: 'Empresa Demonstração', legal_name: 'Empresa Demonstração Serviços Ltda', document_number: '11222333000181', email: 'comercial@demo.invalid', phone: '(11) 4000-1000',
  address: 'Av. Exemplo, 1000', footer_text: 'Documento de demonstração', primary_color: '#162A43', secondary_color: '#22D3EE', logo_data_url: null,
};
// PNG 1x1 válido
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function readPdf(buf: Buffer): Promise<{ pages: string[]; text: string }> {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' '));
  }
  return { pages, text: pages.join(' ') };
}

const snap = (base: TemplateBase, over: Partial<Snapshot> = {}): Snapshot => ({ ...sampleSnapshot(base, 'Modelo', COMPANY), ...over });

describe('PDF da proposta', () => {
  for (const base of ['corporate', 'agency', 'technical'] as const) {
    it(`modelo ${base}: traz número, título, cliente, itens, valores e rodapé`, async () => {
      const s = snap(base);
      const pdf = await renderProposalPdf(s);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const { pages, text } = await readPdf(pdf);
      expect(text).toContain('00000');
      expect(text).toContain('Exemplo de proposta');
      expect(text).toContain('Cliente Exemplo Ltda');
      expect(text).toContain('Diagnóstico e planejamento');
      expect(text).toContain('Implantação');
      expect(text).toContain('R$ 10.200,00'); // total do exemplo
      expect(text).toContain('R$ 5.400,00');   // item com desconto: 6000,00 − 600,00
      expect(text).toMatch(/investimento/i); // títulos de seção podem ser em caixa alta
      expect(text).toMatch(/condições comerciais/i);
      expect(pages.length).toBeLessThanOrEqual(2);
      pages.forEach((p, i) => expect(p).toContain(`página ${i + 1} de ${pages.length}`));
    });
  }

  it('acentuação do português preservada (á é í ó ú ã õ ç)', async () => {
    const s = snap('corporate', { content: sanitizeContent({ sections: [{ id: 'a', kind: 'scope', title: 'Ação e Reflexão', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Condições, prazos, órgãos, coração, informação, índice, útil.' }] }] } }] }) });
    const { text } = await readPdf(await renderProposalPdf(s));
    expect(text.toLowerCase()).toContain('ação e reflexão');
    expect(text).toContain('Condições, prazos, órgãos, coração, informação, índice, útil.');
  });

  it('proposta longa: muitos itens e texto extenso paginam, com rodapé numerado e total na última página', async () => {
    const many = Array.from({ length: 140 }, (_, i) => ({ item_type: 'service' as const, name: `Serviço número ${i + 1}`, description: i % 10 === 0 ? 'Descrição longa do serviço para ocupar mais de uma linha na tabela de itens do documento.' : null, unit: 'h', quantity: 1 + (i % 5), unit_price_cents: 10000 + i * 125, discount_kind: 'none' as const, discount_value: 0, gross_cents: 0, discount_cents: 0, total_cents: 0 }));
    const r = computePricing(many.map((m) => ({ quantity: m.quantity, unit_price_cents: m.unit_price_cents })));
    const items = many.map((m, i) => ({ ...m, gross_cents: r.items[i]!.gross_cents, total_cents: r.items[i]!.total_cents }));
    const longText = Array.from({ length: 60 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Parágrafo ${i + 1} do escopo. ` + 'Texto extenso de exemplo. '.repeat(12) }] }));
    const s = snap('technical', {
      items,
      pricing: { gross_cents: r.gross_cents, items_discount_cents: 0, subtotal_cents: r.subtotal_cents, discount: { kind: 'none', value: 0, amount_cents: 0 }, charges: [], total_cents: r.total_cents },
      content: sanitizeContent({ sections: [{ id: 'e', kind: 'scope', title: 'Escopo', content: { type: 'doc', content: longText } }, { id: 't', kind: 'terms', title: 'Condições comerciais', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pagamento em 30 dias.' }] }] } }] }),
    });
    const { pages, text } = await readPdf(await renderProposalPdf(s));
    expect(pages.length).toBeGreaterThan(3);
    expect(text).toContain('Serviço número 1 ');
    expect(text).toContain('Serviço número 140');
    expect(text).toContain('Parágrafo 60 do escopo');
    pages.forEach((p, i) => expect(p, `rodapé da página ${i + 1}`).toContain(`página ${i + 1} de ${pages.length}`));
    const total = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.total_cents / 100).replace(/ /g, ' ');
    expect(text).toContain(total);
    // o total fica depois de todos os itens
    expect(text.lastIndexOf(total)).toBeGreaterThan(text.indexOf('Serviço número 140'));
  });

  it('valores elevados e centavos aparecem exatos', async () => {
    const s = snap('corporate', { pricing: { ...sampleSnapshot('corporate', 'M', COMPANY).pricing, total_cents: 99_999_999_999 } });
    const { text } = await readPdf(await renderProposalPdf(s));
    expect(text).toContain('R$ 999.999.999,99');
  });

  it('caracteres fora do alfabeto latino viram "?" sem quebrar o PDF', async () => {
    expect(pdfText('Olá — “ok” • 日本語 😀 − 5')).toBe('Olá — “ok” • ??? ? - 5');
    const s = snap('corporate', { proposal: { number: '00000', title: 'Proposta 😀 日本語', currency: 'BRL' } });
    const { text } = await readPdf(await renderProposalPdf(s));
    expect(text).toContain('Proposta ? ???');
  });

  it('logotipo PNG é incorporado; sem logotipo não há imagem', async () => {
    const withLogo = await renderProposalPdf(snap('corporate', { company: { ...COMPANY, logo_data_url: PNG } }));
    const without = await renderProposalPdf(snap('corporate'));
    expect(withLogo.length).toBeGreaterThan(without.length);
    expect(withLogo.toString('latin1')).toContain('/Subtype /Image');
    expect(without.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('rascunho leva a faixa; publicada não', async () => {
    expect((await readPdf(await renderProposalPdf(snap('corporate'), true))).text).toContain('RASCUNHO');
    expect((await readPdf(await renderProposalPdf(snap('corporate'), false))).text).not.toContain('RASCUNHO');
  });

  it('mesmo snapshot gera o mesmo conteúdo (reprodutível)', async () => {
    const s = snap('agency');
    const a = await readPdf(await renderProposalPdf(s));
    const b = await readPdf(await renderProposalPdf(s));
    expect(b.text).toBe(a.text);
  });

  it('links: só http/https/mailto viram link no PDF; javascript: vira texto sem destino', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://exemplo.com.br/a' } }] },
      { type: 'text', text: ' perigo', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
    ] }] };
    const s = snap('corporate', { content: sanitizeContent({ sections: [{ id: 'l', kind: 'scope', title: 'Links', content: doc }] }) });
    const raw = (await renderProposalPdf(s)).toString('latin1');
    expect(raw).toContain('https://exemplo.com.br/a');
    expect(raw.toLowerCase()).not.toContain('javascript:');
  });

  it('nome de arquivo seguro', () => {
    expect(pdfFileName('P-00045', 2)).toBe('Proposta-P-00045-v2.pdf');
    expect(pdfFileName('../../etc/passwd', 1)).toBe('Proposta-etcpasswd-v1.pdf');
  });
});
