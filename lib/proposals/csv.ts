// CSV: exportação segura (neutraliza injeção de fórmula) e leitura de importação de clientes com limites.
import Papa from 'papaparse';

export const MAX_IMPORT_BYTES = 1_000_000; // 1 MB
export const MAX_IMPORT_ROWS = 2000;

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Valores iniciados por = + - @ TAB CR são executados como fórmula no Excel/Sheets ("CSV injection").
 * Prefixa com apóstrofo para virar texto comum. Sempre entre aspas.
 */
export function csvText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Centavos -> "1234,56" (vírgula decimal, sem milhar), para o Excel em português. */
export function csvMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export function csvDecimal(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(decimals).replace('.', ',');
}

/** `int(n)` = contagem; `cents(n)` = dinheiro; número simples = decimal (2 casas). */
export type CsvCell = string | number | null | undefined | { int: number } | { cents: number | null };
export const int = (n: number): CsvCell => ({ int: n });
export const cents = (n: number | null): CsvCell => ({ cents: n });

function cell(c: CsvCell): string {
  if (c !== null && typeof c === 'object') return 'int' in c ? String(c.int) : csvMoney(c.cents);
  if (typeof c === 'number') return csvDecimal(c);
  return csvText(c);
}

/** `;` como separador e vírgula decimal (padrão do Excel em português), UTF-8 com BOM, quebra CRLF. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map((h) => csvText(h)).join(';')];
  for (const row of rows) lines.push(row.map(cell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- importação de clientes
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const CLIENT_HEADER_ALIASES: Record<string, string> = {
  nome: 'name', name: 'name', cliente: 'name',
  razao_social: 'legal_name', legal_name: 'legal_name',
  cpf_cnpj: 'document_number', cnpj: 'document_number', cpf: 'document_number', documento: 'document_number', document: 'document_number', document_number: 'document_number',
  email: 'email', e_mail: 'email',
  telefone: 'phone', celular: 'phone', fone: 'phone', phone: 'phone',
  endereco: 'address', address: 'address',
  tipo: 'type', type: 'type',
  observacoes: 'notes', observacao: 'notes', notas: 'notes', notes: 'notes',
};

export type ParsedCsv =
  | { ok: true; rows: Array<{ line: number; values: Record<string, string> }>; unknownHeaders: string[] }
  | { ok: false; error: string };

/** Lê o CSV de clientes aplicando limites de tamanho e de linhas e mapeando cabeçalhos em português ou inglês. */
export function parseClientsCsv(text: string): ParsedCsv {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'Arquivo muito grande (máximo de 1 MB).' };
  const clean = text.replace(/^﻿/, '');
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' });
  const data = result.data;
  if (data.length < 2) return { ok: false, error: 'O arquivo precisa ter a linha de cabeçalho e ao menos um cliente.' };
  if (data.length - 1 > MAX_IMPORT_ROWS) return { ok: false, error: `Muitas linhas (máximo de ${MAX_IMPORT_ROWS} por importação).` };

  const headers = (data[0] ?? []).map((h) => CLIENT_HEADER_ALIASES[normalizeHeader(h)] ?? null);
  const unknownHeaders = (data[0] ?? []).filter((_, i) => headers[i] === null).map((h) => h.trim()).filter(Boolean);
  if (!headers.includes('name')) return { ok: false, error: 'Não encontrei a coluna de nome ("nome" ou "name").' };

  const rows = data.slice(1).map((cells, i) => {
    const values: Record<string, string> = {};
    headers.forEach((key, idx) => {
      if (key) values[key] = (cells[idx] ?? '').trim();
    });
    return { line: i + 2, values };
  });
  return { ok: true, rows, unknownHeaders };
}
