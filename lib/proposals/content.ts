// Conteúdo comercial (escopo, condições…): documento estruturado (ProseMirror JSON), NUNCA HTML.
// Tudo que entra (editor, API, banco) passa por `sanitizeDoc`/`sanitizeContent`: só nós e marcas permitidos,
// links só http/https/mailto, profundidade e tamanho limitados. A renderização (tela e PDF) é por componentes
// próprios, sem dangerouslySetInnerHTML — não existe caminho para HTML arbitrário.

export type PMMark = { type: 'bold' | 'italic' | 'link'; attrs?: { href: string } };
export type PMNode = {
  type: 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'listItem' | 'horizontalRule' | 'hardBreak' | 'text';
  attrs?: { level?: number };
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
};
export type PMDoc = { type: 'doc'; content: PMNode[] };

export const SECTION_KINDS = ['presentation', 'objective', 'scope', 'deliverables', 'timeline', 'terms', 'closing', 'custom'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export type Section = { id: string; kind: SectionKind; title: string; enabled: boolean; content: PMDoc };
export type ProposalContent = { sections: Section[] };

export const SECTION_LABELS: Record<SectionKind, string> = {
  presentation: 'Apresentação', objective: 'Objetivo', scope: 'Escopo', deliverables: 'Entregáveis',
  timeline: 'Cronograma', terms: 'Condições comerciais', closing: 'Considerações finais', custom: 'Seção personalizada',
};

const MAX_DEPTH = 6;
const MAX_NODES = 3000;
const MAX_TEXT = 20_000;
const MAX_SECTIONS = 30;
const MAX_HREF = 500;

const BLOCKS_IN_DOC = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'horizontalRule']);
const CHILDREN: Record<string, ReadonlySet<string>> = {
  paragraph: new Set(['text', 'hardBreak']),
  heading: new Set(['text', 'hardBreak']),
  bulletList: new Set(['listItem']),
  orderedList: new Set(['listItem']),
  listItem: new Set(['paragraph', 'bulletList', 'orderedList']),
  horizontalRule: new Set(),
  hardBreak: new Set(),
  text: new Set(),
};

export const EMPTY_DOC: PMDoc = { type: 'doc', content: [] };

/** Link seguro: só http, https ou mailto. Devolve o endereço normalizado ou `null`. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_HREF) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') return url.href;
  } catch {
    // endereço inválido
  }
  return null;
}

function cleanMarks(raw: unknown): PMMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PMMark[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const type = (m as { type?: unknown }).type;
    if (type === 'bold' || type === 'italic') {
      if (!out.some((x) => x.type === type)) out.push({ type });
    } else if (type === 'link') {
      const href = safeHref((m as { attrs?: { href?: unknown } }).attrs?.href);
      if (href && !out.some((x) => x.type === 'link')) out.push({ type: 'link', attrs: { href } });
    }
  }
  return out.length ? out : undefined;
}

function cleanNode(raw: unknown, parent: string, depth: number, budget: { n: number }): PMNode | null {
  if (!raw || typeof raw !== 'object' || depth > MAX_DEPTH || budget.n <= 0) return null;
  const node = raw as { type?: unknown; attrs?: { level?: unknown }; content?: unknown; text?: unknown; marks?: unknown };
  const type = typeof node.type === 'string' ? node.type : '';
  const allowed = parent === 'doc' ? BLOCKS_IN_DOC : CHILDREN[parent];
  if (!allowed || !allowed.has(type)) return null;
  budget.n -= 1;

  if (type === 'text') {
    const text = typeof node.text === 'string' ? node.text.slice(0, MAX_TEXT) : '';
    if (text === '') return null;
    const marks = cleanMarks(node.marks);
    return marks ? { type: 'text', text, marks } : { type: 'text', text };
  }
  if (type === 'hardBreak' || type === 'horizontalRule') return { type };

  const children: PMNode[] = [];
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const clean = cleanNode(child, type, depth + 1, budget);
      if (clean) children.push(clean);
    }
  }
  if (type === 'heading') {
    const level = node.attrs?.level === 3 ? 3 : 2;
    return { type: 'heading', attrs: { level }, content: children };
  }
  if ((type === 'bulletList' || type === 'orderedList') && children.length === 0) return null;
  return children.length ? { type: type as PMNode['type'], content: children } : { type: type as PMNode['type'] };
}

/** Documento ProseMirror seguro. Qualquer entrada inválida vira documento vazio. */
export function sanitizeDoc(raw: unknown): PMDoc {
  if (!raw || typeof raw !== 'object' || (raw as { type?: unknown }).type !== 'doc') return { type: 'doc', content: [] };
  const budget = { n: MAX_NODES };
  const content: PMNode[] = [];
  const list = (raw as { content?: unknown }).content;
  if (Array.isArray(list)) {
    for (const child of list) {
      const clean = cleanNode(child, 'doc', 1, budget);
      if (clean) content.push(clean);
    }
  }
  return { type: 'doc', content };
}

function safeId(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : fallback;
}

/** Conteúdo da proposta (lista de seções) seguro e dentro dos limites. */
export function sanitizeContent(raw: unknown): ProposalContent {
  const list = raw && typeof raw === 'object' ? (raw as { sections?: unknown }).sections : null;
  if (!Array.isArray(list)) return { sections: [] };
  const sections: Section[] = [];
  const seen = new Set<string>();
  for (const [i, s] of list.slice(0, MAX_SECTIONS).entries()) {
    if (!s || typeof s !== 'object') continue;
    const sec = s as { id?: unknown; kind?: unknown; title?: unknown; enabled?: unknown; content?: unknown };
    const kind = (SECTION_KINDS as readonly string[]).includes(String(sec.kind)) ? (sec.kind as SectionKind) : 'custom';
    let id = safeId(sec.id, `s${i + 1}`);
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const title = (typeof sec.title === 'string' ? sec.title.trim() : '').slice(0, 160) || SECTION_LABELS[kind];
    sections.push({ id, kind, title, enabled: sec.enabled !== false, content: sanitizeDoc(sec.content) });
  }
  return { sections };
}

/** Texto simples do documento (uma linha por bloco), para busca e resumos. */
export function docToText(doc: PMDoc): string {
  const lines: string[] = [];
  const walk = (n: PMNode) => {
    if (n.type === 'text') { lines.push(n.text ?? ''); return; }
    if (n.type === 'hardBreak') { lines.push('\n'); return; }
    (n.content ?? []).forEach(walk);
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem') lines.push('\n');
  };
  doc.content.forEach(walk);
  return lines.join('').replace(/\n{2,}/g, '\n').trim();
}

export const isDocEmpty = (doc: PMDoc) => docToText(doc) === '' && !doc.content.some((n) => n.type === 'horizontalRule');
