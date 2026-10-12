import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { toCsv, cents, int, type CsvCell } from '@/lib/proposals/csv';
import { formatDate } from '@/lib/proposals/format';
import { PERIOD_LABELS, STATUS_LABELS, parseFilters, type ProposalStatus } from '@/lib/proposals/filters';
import { CLIENT_TYPE_LABELS } from '@/lib/proposals/validation';

export const runtime = 'nodejs';

const MAX_ROWS = 5000;

function csvResponse(name: string, body: string) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Exportações em CSV (UTF-8 com BOM, `;`, fórmulas neutralizadas). O RLS limita ao que o usuário enxerga. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await resolveContext();
  if (auth.kind !== 'ok') return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  const { ctx } = auth;
  const org = ctx.membership.organization_id;
  const { kind } = await params;
  const url = new URL(request.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const f = parseFilters(sp);
  const db = ctx.supabase;

  if (kind === 'clients-template') {
    return csvResponse('modelo-clientes', toCsv(['nome', 'razão social', 'cpf/cnpj', 'e-mail', 'telefone', 'endereço', 'tipo', 'observações'], [['Empresa Exemplo Ltda', 'Empresa Exemplo Ltda', '11222333000181', 'contato@exemplo.com.br', '(11) 99999-0000', 'Rua Exemplo, 100', 'empresa', '']]));
  }

  if (kind === 'clients') {
    const { data } = await db.from('clients').select('name, type, legal_name, document_number, email, phone, address, created_at').eq('organization_id', org).is('archived_at', null).order('name').limit(MAX_ROWS);
    const rows = ((data ?? []) as Array<{ name: string; type: 'company' | 'person'; legal_name: string | null; document_number: string | null; email: string | null; phone: string | null; address: string | null; created_at: string }>)
      .map((c): CsvCell[] => [c.name, CLIENT_TYPE_LABELS[c.type], c.legal_name, c.document_number, c.email, c.phone, c.address, formatDate(c.created_at.slice(0, 10))]);
    return csvResponse('clientes', toCsv(['Nome', 'Tipo', 'Razão social', 'CPF/CNPJ', 'E-mail', 'Telefone', 'Endereço', 'Cadastro'], rows));
  }

  if (kind === 'proposals') {
    let q = db.from('proposals').select('id, proposal_number, title, status, client_id, owner_id, published_revision_id, current_revision_id, first_sent_at, created_at').eq('organization_id', org).is('archived_at', null);
    if (f.status) q = q.eq('status', f.status);
    if (f.owner) q = q.eq('owner_id', f.owner);
    if (f.client) q = q.eq('client_id', f.client);
    const { data } = await q.order('created_at', { ascending: false }).limit(MAX_ROWS);
    const props = (data ?? []) as Array<{ id: string; proposal_number: string; title: string; status: ProposalStatus; client_id: string; owner_id: string | null; published_revision_id: string | null; current_revision_id: string | null; first_sent_at: string | null; created_at: string }>;
    const revIds = [...new Set(props.map((p) => p.published_revision_id ?? p.current_revision_id).filter((x): x is string => Boolean(x)))];
    const [clients, revs, people] = await Promise.all([
      db.from('clients').select('id, name').eq('organization_id', org),
      revIds.length ? db.from('proposal_revisions').select('id, version_number, total_cents, valid_until').in('id', revIds) : Promise.resolve({ data: [] }),
      db.rpc('prop_user_labels', { p_org: org }),
    ]);
    const cMap = new Map(((clients.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
    const rMap = new Map(((revs.data ?? []) as Array<{ id: string; version_number: number; total_cents: number; valid_until: string | null }>).map((r) => [r.id, r]));
    const pMap = new Map(((people.data ?? []) as Array<{ user_id: string; label: string }>).map((p) => [p.user_id, p.label]));
    const rows = props.map((p): CsvCell[] => {
      const r = rMap.get(p.published_revision_id ?? p.current_revision_id ?? '');
      return [p.proposal_number, p.title, cMap.get(p.client_id) ?? '', STATUS_LABELS[p.status], r ? int(r.version_number) : '', cents(r?.total_cents ?? null), r?.valid_until ? formatDate(r.valid_until) : '', p.owner_id ? pMap.get(p.owner_id) ?? '' : '', p.first_sent_at ? formatDate(p.first_sent_at.slice(0, 10)) : '', formatDate(p.created_at.slice(0, 10))];
    });
    return csvResponse('propostas', toCsv(['Número', 'Título', 'Cliente', 'Status', 'Versão', 'Valor (R$)', 'Válida até', 'Responsável', 'Primeiro envio', 'Criada em'], rows));
  }

  if (kind === 'sales-by-rep' || kind === 'clients-ranking' || kind === 'series' || kind === 'status') {
    const args = { p_org: org, p_from: f.from, p_to: f.to, p_owner: f.owner, p_client: f.client, p_status: f.status, p_type: f.itemType };
    const stamp = `${PERIOD_LABELS[f.period]} (${formatDate(f.from)} a ${formatDate(f.to)})`;
    if (kind === 'sales-by-rep') {
      const [{ data }, people] = await Promise.all([db.rpc('prop_rep_performance', args), db.rpc('prop_user_labels', { p_org: org })]);
      const pMap = new Map(((people.data ?? []) as Array<{ user_id: string; label: string }>).map((p) => [p.user_id, p.label]));
      const rows = ((data ?? []) as Array<{ owner_id: string | null; sent_count: number; accepted_count: number; declined_count: number; accepted_cents: number; acceptance_rate: number | null }>)
        .map((r): CsvCell[] => [r.owner_id ? pMap.get(r.owner_id) ?? 'Usuário' : 'Sem responsável', int(r.sent_count), int(r.accepted_count), int(r.declined_count), cents(r.accepted_cents), r.acceptance_rate === null ? '' : Number(r.acceptance_rate)]);
      return csvResponse('propostas-por-vendedor', toCsv(['Vendedor', 'Enviadas', 'Aceitas', 'Recusadas', 'Valor aceito (R$)', `Taxa de aceite (%) — ${stamp}`], rows));
    }
    if (kind === 'clients-ranking') {
      const { data } = await db.rpc('prop_client_ranking', { p_org: org, p_from: f.from, p_to: f.to, p_owner: f.owner, p_status: f.status, p_type: f.itemType, p_limit: 100 });
      const rows = ((data ?? []) as Array<{ client_name: string; accepted_count: number; accepted_cents: number; proposed_cents: number }>).map((r): CsvCell[] => [r.client_name, int(r.accepted_count), cents(r.accepted_cents), cents(r.proposed_cents)]);
      return csvResponse('propostas-por-cliente', toCsv(['Cliente', 'Aceitas', 'Valor aceito (R$)', `Valor proposto (R$) — ${stamp}`], rows));
    }
    if (kind === 'status') {
      const { data } = await db.rpc('prop_status_distribution', { p_org: org, p_from: f.from, p_to: f.to, p_owner: f.owner, p_client: f.client, p_type: f.itemType });
      const rows = ((data ?? []) as Array<{ status: ProposalStatus; proposal_count: number; total_cents: number }>).map((r): CsvCell[] => [STATUS_LABELS[r.status], int(r.proposal_count), cents(r.total_cents)]);
      return csvResponse('propostas-por-status', toCsv(['Status', 'Propostas', `Valor (R$) — ${stamp}`], rows));
    }
    const { data } = await db.rpc('prop_series', args);
    const rows = ((data ?? []) as Array<{ bucket: string; created_count: number; sent_count: number; proposed_cents: number; accepted_count: number; declined_count: number; accepted_cents: number; acceptance_rate: number | null }>)
      .map((r): CsvCell[] => [formatDate(r.bucket), int(r.created_count), int(r.sent_count), cents(r.proposed_cents), int(r.accepted_count), int(r.declined_count), cents(r.accepted_cents), r.acceptance_rate === null ? '' : Number(r.acceptance_rate)]);
    return csvResponse('propostas-por-periodo', toCsv([`Início do período — ${stamp}`, 'Criadas', 'Enviadas', 'Valor proposto (R$)', 'Aceitas', 'Recusadas', 'Valor aceito (R$)', 'Taxa de aceite (%)'], rows));
  }

  return NextResponse.json({ error: 'Relatório desconhecido.' }, { status: 404 });
}
