import { describe, expect, it } from 'vitest';
import { cents, csvMoney, csvText, int, MAX_IMPORT_ROWS, parseClientsCsv, toCsv } from '@/lib/proposals/csv';
import { addDays, daysBetween, filtersToQuery, isRealDate, parseFilters, todaySaoPaulo } from '@/lib/proposals/filters';
import { centsToInput, formatDays, formatDocument, formatMoney, formatPct, formatQuantity, isValidDocument, parseDecimalText, parseMoneyToCents } from '@/lib/proposals/format';
import { bucketLabel, bucketUnit, goalsInPeriod, summarizeGoals } from '@/lib/proposals/chart-rows';
import { variationPct } from '@/lib/proposals/dashboard';
import { buildDraftSnapshot } from '@/lib/proposals/draft-snapshot';
import { catalogItemSchema, clientSchema, decisionSchema, draftSchema, goalSchema, settingsSchema } from '@/lib/proposals/validation';
import { generateShareToken, hashToken, isTokenShape } from '@/lib/proposals/tokens';

const nb = (s: string) => s.replace(/ /g, ' ');

describe('dinheiro e números no padrão brasileiro', () => {
  it('formata centavos sem ponto flutuante visível', () => {
    expect(nb(formatMoney(232610))).toBe('R$ 2.326,10');
    expect(nb(formatMoney(0))).toBe('R$ 0,00');
    expect(nb(formatMoney(99_999_999_999))).toBe('R$ 999.999.999,99');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(Number.NaN)).toBe('—');
    expect(formatPct(70)).toBe('70,00%');
    expect(formatPct(null)).toBe('—');
    expect(formatDays(1)).toBe('1 dia');
    expect(formatDays(4.7)).toBe('4,7 dias');
    expect(formatQuantity('2.5')).toBe('2,5');
  });

  it('lê valores digitados em reais e devolve centavos inteiros', () => {
    const ok: Array<[string, number]> = [['1.234,56', 123456], ['1234,5', 123450], ['1234.56', 123456], ['R$ 10', 1000], ['0,01', 1], ['10,', 1000], ['1.000', 100000], ['999999999,99', 99_999_999_999]];
    for (const [input, expected] of ok) expect(parseMoneyToCents(input), input).toBe(expected);
    for (const bad of ['', 'abc', '1,234,56', '1.23.4', '-5', '10,999', '1000000000,00', '1e3']) expect(parseMoneyToCents(bad), bad).toBeNull();
    expect(centsToInput(123456)).toBe('1234,56');
    expect(centsToInput(5)).toBe('0,05');
    expect(parseMoneyToCents(centsToInput(99_999_999_999))).toBe(99_999_999_999);
  });

  it('quantidade e percentual decimais', () => {
    expect(parseDecimalText('2,5', 4)).toBe('2.5');
    expect(parseDecimalText('10.0000', 4)).toBe('10');
    expect(parseDecimalText('0.3333', 4)).toBe('0.3333');
    expect(parseDecimalText('1.00001', 4)).toBeNull();
    expect(parseDecimalText('abc', 4)).toBeNull();
    expect(parseDecimalText('-1', 4)).toBeNull();
    expect(parseDecimalText('12.345', 2)).toBeNull();
  });

  it('CPF e CNPJ: dígitos verificadores', () => {
    for (const ok of ['529.982.247-25', '52998224725', '11.222.333/0001-81', '11444777000161', '']) expect(isValidDocument(ok), ok).toBe(true);
    for (const bad of ['111.111.111-11', '529.982.247-26', '11.222.333/0001-82', '123', '00000000000000']) expect(isValidDocument(bad), bad).toBe(false);
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
  });
});

describe('filtros do painel', () => {
  const today = '2026-10-12';
  it('padrão: últimos 30 dias, inclusive hoje', () => {
    const f = parseFilters({}, today);
    expect(f).toMatchObject({ period: '30d', from: '2026-09-13', to: today, owner: null, client: null, status: null, itemType: null });
  });
  it('presets e período personalizado válido', () => {
    expect(parseFilters({ period: '7d' }, today).from).toBe('2026-10-06');
    expect(parseFilters({ period: '90d' }, today).from).toBe('2026-07-15');
    expect(parseFilters({ period: 'custom', from: '2026-01-01', to: '2026-01-31' }, today)).toMatchObject({ period: 'custom', from: '2026-01-01', to: '2026-01-31' });
  });
  it('entradas inválidas caem no padrão sem erro', () => {
    for (const q of [{ period: 'custom', from: 'lixo', to: '2020-99-99' }, { period: 'xyz' }, { period: 'custom', from: '2026-09-30', to: '2026-09-01' }, { period: 'custom', from: '2020-01-01', to: '2026-01-01' }]) {
      expect(parseFilters(q, today).period).toBe('30d');
    }
    const f = parseFilters({ owner: "1' or 1=1--", client: 'x', status: 'hack', type: 'y' }, today);
    expect(f).toMatchObject({ owner: null, client: null, status: null, itemType: null });
    expect(parseFilters({ owner: '7a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', status: 'accepted', type: 'service' }, today)).toMatchObject({ owner: '7a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', status: 'accepted', itemType: 'service' });
  });
  it('datas: fronteiras de mês e ano bissexto, e consulta canônica', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(todaySaoPaulo(new Date('2026-10-12T02:30:00Z'))).toBe('2026-10-11'); // ainda é dia 11 em Brasília
    expect(filtersToQuery(parseFilters({ period: 'custom', from: '2026-01-01', to: '2026-01-31', status: 'sent' }, today))).toBe('period=custom&from=2026-01-01&to=2026-01-31&status=sent');
  });
});

describe('CSV', () => {
  it('neutraliza fórmulas e escapa aspas', () => {
    expect(csvText('=1+1')).toBe(`"'=1+1"`);
    expect(csvText('+55 11')).toBe(`"'+55 11"`);
    expect(csvText('-x')).toBe(`"'-x"`);
    expect(csvText('@soma')).toBe(`"'@soma"`);
    expect(csvText('\tx')).toBe(`"'\tx"`);
    expect(csvText('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvText(null)).toBe('');
  });
  it('dinheiro em centavos e formato do arquivo', () => {
    expect(csvMoney(232610)).toBe('2326,10');
    expect(csvMoney(5)).toBe('0,05');
    expect(csvMoney(null)).toBe('');
    const out = toCsv(['A', 'B', 'C'], [['x', cents(100050), int(3)]]);
    expect(out).toBe('﻿"A";"B";"C"\r\n"x";1000,50;3\r\n');
  });
  it('importação: cabeçalhos em português/inglês, limites e BOM', () => {
    const r = parseClientsCsv('﻿Nome;CPF/CNPJ;E-mail;Cor\r\nAna;529.982.247-25;a@x.com;azul\r\n');
    expect(r.ok && r.rows[0]!.values).toMatchObject({ name: 'Ana', document_number: '529.982.247-25', email: 'a@x.com' });
    expect(r.ok && r.unknownHeaders).toEqual(['Cor']);
    expect(parseClientsCsv('x;y\n1;2').ok).toBe(false);
    expect(parseClientsCsv('nome\n').ok).toBe(false);
    expect(parseClientsCsv(`nome\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `c${i}`).join('\n')}`).ok).toBe(false);
    expect(parseClientsCsv('a'.repeat(1_000_001)).ok).toBe(false);
  });
});

describe('validação dos formulários', () => {
  it('cliente: normaliza e valida', () => {
    const r = clientSchema.parse({ type: 'company', name: '  Acme  ', legal_name: '', document_number: '11.222.333/0001-81', email: ' ACME@X.COM ', phone: '', address: '', notes: '' });
    expect(r).toMatchObject({ name: 'Acme', legal_name: null, document_number: '11222333000181', email: 'acme@x.com', phone: null });
    expect(clientSchema.safeParse({ type: 'company', name: 'A', document_number: '', email: '', legal_name: '', phone: '', address: '', notes: '' }).success).toBe(false);
    expect(clientSchema.safeParse({ type: 'company', name: 'Acme', document_number: '123', email: '', legal_name: '', phone: '', address: '', notes: '' }).success).toBe(false);
    expect(clientSchema.safeParse({ type: 'company', name: 'Acme', document_number: '', email: 'sem-arroba', legal_name: '', phone: '', address: '', notes: '' }).success).toBe(false);
  });
  it('catálogo: preço em reais vira centavos', () => {
    const r = catalogItemSchema.parse({ type: 'service', name: 'Consultoria', description: '', sku: '', unit: 'h', default_price: '150,00', active: true });
    expect(r.default_price).toBe(15000);
    expect(r.sku).toBeNull(); // código vazio = sem código
    expect(catalogItemSchema.safeParse({ type: 'service', name: 'X', description: '', sku: '', unit: 'h', default_price: '-1', active: true }).success).toBe(false);
  });
  it('rascunho: limites de itens e encargos, descontos e datas', () => {
    const item = { catalog_item_id: null, item_type: 'service', name: 'x', description: null, unit: 'un', quantity: '1', unit_price_cents: 100, discount_kind: 'none', discount_value: '0' };
    const base = { title: 'Proposta', client_id: '7a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', template_id: null, issue_date: '2026-10-12', valid_until: '', discount: { kind: 'none', value: '0' }, charges: [], items: [item], content: { sections: [] } };
    expect(draftSchema.safeParse(base).success).toBe(true);
    expect(draftSchema.parse(base).valid_until).toBeNull();
    expect(draftSchema.safeParse({ ...base, items: Array.from({ length: 201 }, () => item) }).success).toBe(false);
    expect(draftSchema.safeParse({ ...base, charges: Array.from({ length: 11 }, () => ({ label: 'x', kind: 'fixed', value: '1' })) }).success).toBe(false);
    expect(draftSchema.safeParse({ ...base, items: [{ ...item, quantity: '0' }] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...base, items: [{ ...item, quantity: '1.00001' }] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...base, items: [{ ...item, unit_price_cents: -1 }] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...base, items: [{ ...item, discount_value: '-5' }] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...base, issue_date: '2026-02-30' }).success).toBe(false);
  });
  it('decisão do cliente exige confirmação, nome e e-mail', () => {
    const ok = { decision: 'accepted', name: 'Fulano', email: ' FULANO@X.COM ', comment: '', confirm: true };
    expect(decisionSchema.parse(ok)).toMatchObject({ email: 'fulano@x.com', comment: null });
    expect(decisionSchema.safeParse({ ...ok, confirm: false }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...ok, name: 'F' }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...ok, email: 'x' }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...ok, decision: 'talvez' }).success).toBe(false);
  });
  it('configurações e metas', () => {
    const s = settingsSchema.parse({ legal_name: '', document_number: '', email: '', phone: '', address: '', footer_text: '', number_prefix: 'P-', default_validity_days: '30', default_terms: '', primary_color: '#162a43', secondary_color: '#22d3ee', max_discount_member_pct: '10,5', max_discount_manager_pct: '30', alert_expiring_days: '7', alert_no_reply_days: '5', alert_recent_accept_days: '7' });
    expect(s).toMatchObject({ primary_color: '#162A43', max_discount_member_pct: '10.5', default_validity_days: 30 });
    expect(settingsSchema.safeParse({ ...s, max_discount_member_pct: '101', default_validity_days: '30' }).success).toBe(false);
    const g = goalSchema.safeParse({ user_id: '7a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', period_start: '2026-10-01', period_end: '2026-09-01', target: '1000' });
    expect(g.success).toBe(false);
    expect(goalSchema.parse({ user_id: '7a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', period_start: '2026-10-01', period_end: '2026-10-31', target: '50.000,00' }).target).toBe(5_000_000);
    expect(goalSchema.safeParse({ user_id: '7a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', period_start: '2026-10-01', period_end: '2026-10-31', target: '0' }).success).toBe(false);
  });
});

describe('painel: preparação dos dados', () => {
  it('buckets: semana até 90 dias, mês acima; rótulos', () => {
    expect(bucketUnit('2026-01-01', '2026-03-31')).toBe('week');
    expect(bucketUnit('2026-01-01', '2026-04-02')).toBe('month');
    expect(bucketLabel('2026-08-31', 'week')).toBe('31/08');
    expect(bucketLabel('2026-09-01', 'month')).toBe('set/26');
  });
  it('variação percentual só quando faz sentido', () => {
    expect(variationPct(150, 100)).toBe(50);
    expect(variationPct(50, 100)).toBe(-50);
    expect(variationPct(10, 0)).toBeNull();
    expect(variationPct(null, 10)).toBeNull();
    expect(variationPct(10, null)).toBeNull();
    expect(variationPct(100, 300)).toBe(-66.7);
  });
  it('metas: soma em centavos e metas que cruzam o período', () => {
    const goals = [
      { goal_id: 'a', user_id: 'u1', period_start: '2026-10-01', period_end: '2026-10-31', target_cents: 4_000_000, achieved_cents: 1_000_010, pct: 25, elapsed_pct: 40 },
      { goal_id: 'b', user_id: 'u2', period_start: '2026-10-01', period_end: '2026-10-31', target_cents: 3_000_000, achieved_cents: 3_000_000, pct: 100, elapsed_pct: 40 },
      { goal_id: 'c', user_id: 'u1', period_start: '2025-01-01', period_end: '2025-01-31', target_cents: 1, achieved_cents: 0, pct: 0, elapsed_pct: 100 },
    ];
    expect(goalsInPeriod(goals, '2026-10-10', '2026-10-20').map((g) => g.goal_id)).toEqual(['a', 'b']);
    expect(summarizeGoals(goalsInPeriod(goals, '2026-10-10', '2026-10-20'))).toEqual({ count: 2, targetCents: 7_000_000, achievedCents: 4_000_010, pct: 57.14, met: 1 });
    expect(summarizeGoals([])).toEqual({ count: 0, targetCents: 0, achievedCents: 0, pct: null, met: 0 });
  });
});

describe('snapshot provisório e tokens', () => {
  it('rascunho usa o motor de cálculo; valores inválidos viram erro, não documento enganoso', () => {
    const company = { name: 'E', legal_name: null, document_number: null, email: null, phone: null, address: null, footer_text: null, primary_color: '#162A43', secondary_color: '#22D3EE', logo_data_url: null };
    const client = { type: 'company' as const, name: 'C', legal_name: null, document_number: null, email: null, phone: null, address: null };
    const base = { number: '1', title: 'T', version: 1, issueDate: '2026-10-12', validUntil: null, templateBase: 'corporate' as const, templateName: null, content: { sections: [] }, discount: { kind: 'percent' as const, value: '10' }, charges: [], company, client };
    const ok = buildDraftSnapshot({ ...base, items: [{ item_type: 'service', name: 'a', description: null, unit: 'un', quantity: '2', unit_price_cents: 5000, discount_kind: 'none', discount_value: '0' }] });
    expect(ok.ok && ok.snapshot.pricing.total_cents).toBe(9000);
    const bad = buildDraftSnapshot({ ...base, items: [{ item_type: 'service', name: 'a', description: null, unit: 'un', quantity: '0', unit_price_cents: 5000, discount_kind: 'none', discount_value: '0' }] });
    expect(bad.ok).toBe(false);
  });
  it('token de 256 bits; só o hash é guardado', () => {
    const { token, hash } = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isTokenShape(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(generateShareToken().token).not.toBe(token);
    for (const bad of ['', 'curto', 'x'.repeat(44), '../etc/passwd', 'a'.repeat(42) + '!']) expect(isTokenShape(bad)).toBe(false);
  });
});
