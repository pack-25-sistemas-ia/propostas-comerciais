import { describe, expect, it } from 'vitest';
import { docToText, isDocEmpty, safeHref, sanitizeContent, sanitizeDoc } from '@/lib/proposals/content';

const p = (...children: unknown[]) => ({ type: 'paragraph', content: children });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, marks });

describe('conteúdo comercial seguro (nunca HTML)', () => {
  it('links: só http, https e mailto', () => {
    expect(safeHref('https://exemplo.com.br/a?b=1')).toBe('https://exemplo.com.br/a?b=1');
    expect(safeHref('mailto:vendas@exemplo.com')).toBe('mailto:vendas@exemplo.com');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', '//exemplo.com', '/relativo', '', 'x'.repeat(600)]) {
      expect(safeHref(bad), bad.slice(0, 20)).toBeNull();
    }
    expect(safeHref(42)).toBeNull();
  });

  it('remove link perigoso mas mantém o texto', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [p(t('clique', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))] });
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'clique' }] });
  });

  it('mantém negrito, itálico e link válido', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [p(t('olá', [{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href: 'https://x.com' } }]))] });
    expect(doc.content[0]!.content![0]!.marks).toEqual([{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href: 'https://x.com/' } }]);
  });

  it('descarta nós desconhecidos (script, imagem, iframe, html cru) e atributos extras', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'script', content: [t('alert(1)')] },
        { type: 'image', attrs: { src: 'http://x/y.png' } },
        { type: 'html', text: '<img src=x onerror=alert(1)>' },
        { type: 'paragraph', attrs: { onclick: 'x' }, content: [t('ok'), { type: 'iframe' }] },
      ],
    });
    expect(doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }] });
  });

  it('respeita a estrutura: texto solto na raiz e lista sem item são removidos', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [t('solto'), { type: 'bulletList', content: [p(t('x'))] }, { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('item'))] }] }] });
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0]!.type).toBe('bulletList');
  });

  it('título só nível 2 ou 3', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [t('A')] }, { type: 'heading', attrs: { level: 3 }, content: [t('B')] }] });
    expect(doc.content.map((n) => n.attrs?.level)).toEqual([2, 3]);
  });

  it('entradas inválidas viram documento vazio', () => {
    for (const bad of [null, undefined, 'texto', 42, [], {}, { type: 'paragraph' }]) {
      expect(sanitizeDoc(bad)).toEqual({ type: 'doc', content: [] });
    }
  });

  it('limita profundidade, quantidade de nós e tamanho de texto', () => {
    let nested: unknown = p(t('fundo'));
    for (let i = 0; i < 20; i++) nested = { type: 'bulletList', content: [{ type: 'listItem', content: [nested] }] };
    const deep = sanitizeDoc({ type: 'doc', content: [nested] });
    expect(JSON.stringify(deep).includes('fundo')).toBe(false);
    const many = sanitizeDoc({ type: 'doc', content: Array.from({ length: 5000 }, () => p(t('x'))) });
    expect(many.content.length).toBeLessThanOrEqual(3000);
    const long = sanitizeDoc({ type: 'doc', content: [p(t('a'.repeat(50_000)))] });
    expect(long.content[0]!.content![0]!.text).toHaveLength(20_000);
  });

  it('seções: kind inválido vira "custom", id repetido ganha sufixo, limite de 30, título padrão', () => {
    const c = sanitizeContent({ sections: [
      { id: 'a', kind: 'scope', title: '  Escopo  ', content: { type: 'doc', content: [p(t('x'))] } },
      { id: 'a', kind: 'hack', title: '', enabled: false },
      { id: '<script>', kind: 'terms' },
      ...Array.from({ length: 40 }, () => ({ kind: 'custom' })),
    ] });
    expect(c.sections).toHaveLength(30);
    expect(c.sections[0]).toMatchObject({ id: 'a', kind: 'scope', title: 'Escopo', enabled: true });
    expect(c.sections[1]).toMatchObject({ id: 'ax', kind: 'custom', title: 'Seção personalizada', enabled: false });
    expect(c.sections[2]!.id).toBe('s3');
    expect(new Set(c.sections.map((s) => s.id)).size).toBe(30);
    expect(sanitizeContent(null)).toEqual({ sections: [] });
    expect(sanitizeContent({ sections: 'x' })).toEqual({ sections: [] });
  });

  it('texto simples e detecção de vazio', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [t('Título')] }, p(t('Linha 1'), { type: 'hardBreak' }, t('Linha 2')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Item'))] }] }] });
    expect(docToText(doc)).toBe('Título\nLinha 1\nLinha 2\nItem');
    expect(isDocEmpty({ type: 'doc', content: [] })).toBe(true);
    expect(isDocEmpty(doc)).toBe(false);
  });
});
