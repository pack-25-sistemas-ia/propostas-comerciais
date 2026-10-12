import 'server-only';
import { Document, Image, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { isDocEmpty, safeHref, type PMNode, type Section } from '@/lib/proposals/content';
import { formatDate, formatDocument, formatMoney, formatQuantity } from '@/lib/proposals/format';
import type { Snapshot } from '@/lib/proposals/snapshot';

// PDF A4 gerado SÓ a partir do snapshot da revisão (reproduz sempre o mesmo documento).
// Fontes padrão do PDF (Helvetica): cobrem o português. Caracteres fora do alfabeto latino viram "?" (limitação conhecida).

const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));
export function pdfText(value: string): string {
  let out = '';
  for (const ch of value.replace(/−/g, '-').replace(/ /g, ' ')) {
    const code = ch.codePointAt(0) ?? 0;
    out += code === 9 || code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || CP1252_EXTRA.has(ch) ? ch : '?';
  }
  return out;
}

const INK = '#0B1220';
const MUTED = '#475569';
const LINE = '#CBD5E1';

function styles(primary: string, secondary: string) {
  return StyleSheet.create({
    page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 42, fontFamily: 'Helvetica', fontSize: 9.5, color: INK },
    h1: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: primary, marginTop: 14, marginBottom: 10, lineHeight: 1.2 },
    h1Light: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', marginTop: 14, lineHeight: 1.2 },
    h2: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: primary, marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
    h2Agency: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: primary, marginTop: 14, marginBottom: 6 },
    h3: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 3 },
    h4: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 6, marginBottom: 2 },
    p: { marginBottom: 5 },
    muted: { color: MUTED },
    row: { flexDirection: 'row' },
    between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    headerLine: { borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 12 },
    techHeader: { borderBottomWidth: 2, borderBottomColor: primary, paddingBottom: 8, marginBottom: 10 },
    agencyHeader: { backgroundColor: primary, padding: 18, borderRadius: 6, marginBottom: 14 },
    logo: { height: 34, maxWidth: 120, objectFit: 'contain' },
    parties: { flexDirection: 'row', gap: 24, marginTop: 8, marginBottom: 6 },
    party: { flex: 1 },
    partyTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
    th: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase' },
    tableHead: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: primary, paddingVertical: 4 },
    tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 5 },
    cName: { flex: 4.2, paddingRight: 6 },
    cQty: { flex: 1.5, textAlign: 'right', paddingRight: 6 },
    cUnit: { flex: 1.8, textAlign: 'right', paddingRight: 6 },
    cDisc: { flex: 1.6, textAlign: 'right', paddingRight: 6 },
    cTotal: { flex: 1.9, textAlign: 'right' },
    totalRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 2 },
    totalLabel: { width: 190, textAlign: 'right', color: MUTED, paddingRight: 8 },
    totalValue: { width: 90, textAlign: 'right' },
    grand: { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1.5, borderTopColor: primary, marginTop: 3, paddingTop: 4 },
    grandText: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
    li: { flexDirection: 'row', marginBottom: 2 },
    bullet: { width: 14 },
    accent: { color: secondary },
    footer: { position: 'absolute', bottom: 22, left: 42, right: 42, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 5, fontSize: 7.5, color: MUTED, flexDirection: 'row', justifyContent: 'space-between' },
  });
}
type S = ReturnType<typeof styles>;

function fontFor(marks: PMNode['marks']): string {
  const bold = marks?.some((m) => m.type === 'bold');
  const italic = marks?.some((m) => m.type === 'italic');
  return bold && italic ? 'Helvetica-BoldOblique' : bold ? 'Helvetica-Bold' : italic ? 'Helvetica-Oblique' : 'Helvetica';
}

function Inline({ node }: { node: PMNode }): ReactNode {
  if (node.type === 'hardBreak') return '\n';
  if (node.type !== 'text') return null;
  const link = node.marks?.find((m) => m.type === 'link');
  const href = link ? safeHref(link.attrs?.href) : null;
  const text = <Text style={{ fontFamily: fontFor(node.marks), ...(href ? { textDecoration: 'underline' as const } : {}) }}>{pdfText(node.text ?? '')}</Text>;
  return href ? <Link src={href}>{text}</Link> : text;
}

function Block({ node, s, ordered, index }: { node: PMNode; s: S; ordered?: boolean; index?: number }): ReactNode {
  const kids = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
      return <Text style={s.p}>{kids.map((k, i) => <Inline key={i} node={k} />)}</Text>;
    case 'heading':
      return <Text style={node.attrs?.level === 3 ? s.h4 : s.h3}>{kids.map((k, i) => <Inline key={i} node={k} />)}</Text>;
    case 'bulletList':
    case 'orderedList':
      return <View style={{ marginBottom: 4 }}>{kids.map((k, i) => <Block key={i} node={k} s={s} ordered={node.type === 'orderedList'} index={i} />)}</View>;
    case 'listItem':
      return (
        <View style={s.li} wrap={false}>
          <Text style={s.bullet}>{ordered ? `${(index ?? 0) + 1}.` : '•'}</Text>
          <View style={{ flex: 1 }}>
            {kids.map((k, i) => (k.type === 'paragraph'
              ? <Text key={i}>{(k.content ?? []).map((c, j) => <Inline key={j} node={c} />)}</Text>
              : <Block key={i} node={k} s={s} />))}
          </View>
        </View>
      );
    case 'horizontalRule':
      return <View style={{ borderBottomWidth: 0.5, borderBottomColor: LINE, marginVertical: 6 }} />;
    default:
      return null;
  }
}

function SectionPdf({ section, index, snap, s }: { section: Section; index: number; snap: Snapshot; s: S }) {
  const agency = snap.template.base === 'agency';
  return (
    <View>
      <Text style={agency ? s.h2Agency : s.h2} minPresenceAhead={60}>{agency ? `${String(index + 1).padStart(2, '0')}  ` : ''}{pdfText(section.title)}</Text>
      {section.content.content.map((n, i) => <Block key={i} node={n} s={s} />)}
    </View>
  );
}

function Pricing({ snap, s }: { snap: Snapshot; s: S }) {
  const p = snap.pricing;
  const base = snap.template.base;
  // tabela curta fica inteira na mesma página (não deixa o cabeçalho sozinho); tabela longa pode quebrar entre linhas
  return (
    <View wrap={snap.items.length > 12}>
      <Text style={base === 'agency' ? s.h2Agency : s.h2} minPresenceAhead={80}>Investimento</Text>
      <View style={s.tableHead} wrap={false}>
        <Text style={[s.th, s.cName]}>Item</Text>
        <Text style={[s.th, s.cQty]}>Qtd.</Text>
        <Text style={[s.th, s.cUnit]}>Valor unit.</Text>
        <Text style={[s.th, s.cDisc]}>Desconto</Text>
        <Text style={[s.th, s.cTotal]}>Total</Text>
      </View>
      {snap.items.map((it, i) => (
        <View key={i} style={s.tr} wrap={false}>
          <View style={s.cName}>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>{pdfText(it.name)}</Text>
            {it.description ? <Text style={[s.muted, { fontSize: 8.5 }]}>{pdfText(it.description)}</Text> : null}
          </View>
          <Text style={s.cQty}>{formatQuantity(it.quantity)} {pdfText(it.unit)}</Text>
          <Text style={s.cUnit}>{formatMoney(it.unit_price_cents)}</Text>
          <Text style={s.cDisc}>{it.discount_cents > 0 ? `- ${formatMoney(it.discount_cents)}` : '-'}</Text>
          <Text style={[s.cTotal, { fontFamily: 'Helvetica-Bold' }]}>{formatMoney(it.total_cents)}</Text>
        </View>
      ))}
      <View style={{ marginTop: 6 }} wrap={false}>
        {p.items_discount_cents > 0 ? <View style={s.totalRow}><Text style={s.totalLabel}>Valor bruto dos itens</Text><Text style={s.totalValue}>{formatMoney(p.gross_cents)}</Text></View> : null}
        <View style={s.totalRow}><Text style={s.totalLabel}>Subtotal</Text><Text style={s.totalValue}>{formatMoney(p.subtotal_cents)}</Text></View>
        {p.discount.amount_cents > 0 ? (
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Desconto{p.discount.kind === 'percent' ? ` (${p.discount.value.toLocaleString('pt-BR')}%)` : ''}</Text>
            <Text style={s.totalValue}>- {formatMoney(p.discount.amount_cents)}</Text>
          </View>
        ) : null}
        {p.charges.map((c, i) => (
          <View key={i} style={s.totalRow}>
            <Text style={s.totalLabel}>{pdfText(c.label)}{c.kind === 'percent' ? ` (${c.value.toLocaleString('pt-BR')}%)` : ''}</Text>
            <Text style={s.totalValue}>+ {formatMoney(c.amount_cents)}</Text>
          </View>
        ))}
        <View style={s.grand}><Text style={[s.totalLabel, s.grandText, { color: INK }]}>Total</Text><Text style={[s.totalValue, s.grandText]}>{formatMoney(p.total_cents)}</Text></View>
      </View>
    </View>
  );
}

function Party({ title, lines, s }: { title: string; lines: Array<string | null | undefined>; s: S }) {
  const shown = lines.filter((l): l is string => Boolean(l));
  return (
    <View style={s.party}>
      <Text style={s.partyTitle}>{title}</Text>
      {shown.map((l, i) => <Text key={i} style={i === 0 ? { fontFamily: 'Helvetica-Bold' } : s.muted}>{pdfText(l)}</Text>)}
    </View>
  );
}

export function ProposalPdf({ snapshot, draft = false }: { snapshot: Snapshot; draft?: boolean }) {
  const { company, client, proposal, revision, template } = snapshot;
  const base = template.base;
  const s = styles(company.primary_color, company.secondary_color);
  const visible = snapshot.content.sections.filter((x) => x.enabled && !isDocEmpty(x.content));
  const idxPricing = base === 'technical' ? 0 : (() => { const i = visible.findIndex((x) => x.kind === 'terms' || x.kind === 'closing'); return i === -1 ? visible.length : i; })();
  // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer não tem atributo alt (é um PDF)
  const logo = company.logo_data_url ? <Image src={company.logo_data_url} style={s.logo} /> : null;

  const header = base === 'agency' ? (
    <View style={s.agencyHeader}>
      <View style={s.between}>
        <View style={[s.row, { alignItems: 'center', gap: 8 }]}>{logo}<Text style={{ color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 13 }}>{pdfText(company.name)}</Text></View>
        <Text style={{ color: '#FFFFFF', fontSize: 8.5, textAlign: 'right' }}>Proposta {proposal.number} - v{revision.version}{'\n'}Emitida em {formatDate(revision.issue_date)}</Text>
      </View>
      <Text style={s.h1Light}>{pdfText(proposal.title)}</Text>
      <Text style={{ color: '#FFFFFF', fontSize: 9, marginTop: 4 }}>Preparada para {pdfText(client.name)}{revision.valid_until ? ` - válida até ${formatDate(revision.valid_until)}` : ''}</Text>
    </View>
  ) : base === 'technical' ? (
    <View>
    <View style={[s.between, s.techHeader]}>
      <View style={[s.row, { alignItems: 'center', gap: 8 }]}>{logo}<View><Text style={{ fontFamily: 'Helvetica-Bold' }}>{pdfText(company.name)}</Text><Text style={[s.muted, { fontSize: 8 }]}>{pdfText([company.phone, company.email].filter(Boolean).join(' - '))}</Text></View></View>
      <View><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 14, color: company.primary_color, textAlign: 'right' }}>ORÇAMENTO {proposal.number}</Text><Text style={[s.muted, { fontSize: 8, textAlign: 'right' }]}>v{revision.version} - {formatDate(revision.issue_date)}{revision.valid_until ? ` - válido até ${formatDate(revision.valid_until)}` : ''}</Text></View>
    </View>
    <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>{pdfText(proposal.title)}</Text>
    </View>
  ) : (
    <View>
      <View style={[s.between, s.headerLine]}>
        <View style={[s.row, { alignItems: 'center', gap: 8 }]}>{logo}<Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 13, color: company.primary_color }}>{pdfText(company.name)}</Text></View>
        <Text style={[s.muted, { fontSize: 8.5, textAlign: 'right' }]}><Text style={{ fontFamily: 'Helvetica-Bold', color: INK, fontSize: 10 }}>Proposta {proposal.number} - v{revision.version}</Text>{'\n'}Emitida em {formatDate(revision.issue_date)}{revision.valid_until ? `\nVálida até ${formatDate(revision.valid_until)}` : ''}</Text>
      </View>
      <Text style={s.h1}>{pdfText(proposal.title)}</Text>
    </View>
  );

  const body: ReactNode[] = [];
  const pricing = <Pricing key="pricing" snap={snapshot} s={s} />;
  visible.forEach((sec, i) => {
    if (i === idxPricing) body.push(pricing);
    body.push(<SectionPdf key={sec.id} section={sec} index={i} snap={snapshot} s={s} />);
  });
  if (idxPricing >= visible.length) body.push(pricing);

  return (
    <Document title={pdfText(`Proposta ${proposal.number} - ${proposal.title}`)} author={pdfText(company.name)} subject={pdfText(proposal.title)} creator="Gestão de Propostas Comerciais">
      <Page size="A4" style={s.page}>
        {/* lineHeight fica num contêiner do CORPO, não na página: com lineHeight na página o react-pdf descarta o rodapé com número de página */}
        <View style={{ lineHeight: 1.4 }}>
        {draft ? <Text style={{ color: '#B91C1C', fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 8 }}>RASCUNHO — esta não é uma proposta enviada ao cliente.</Text> : null}
        {header}
        <View style={s.parties}>
          <Party s={s} title="Cliente" lines={[client.name, client.legal_name && client.legal_name !== client.name ? client.legal_name : null, client.document_number ? formatDocument(client.document_number) : null, client.email, client.phone, client.address]} />
          <Party s={s} title="Fornecedor" lines={[company.name, company.legal_name && company.legal_name !== company.name ? company.legal_name : null, company.document_number ? formatDocument(company.document_number) : null, company.email, company.phone, company.address]} />
        </View>
        {body}
        </View>
        <View style={s.footer} fixed>
          <Text>{pdfText([company.footer_text, company.legal_name ?? company.name].filter(Boolean).join(' - ').replace(/\s*\n\s*/g, ' - '))}</Text>
          <Text render={({ pageNumber, totalPages }) => `Proposta ${proposal.number} - v${revision.version} - página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
