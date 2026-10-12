// Formatação e leitura de valores no padrão brasileiro. Dinheiro SEMPRE em centavos inteiros.
const TZ = 'America/Sao_Paulo';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

/** Centavos -> "R$ 1.234,56". `null`/inválido vira "—". */
export function formatMoney(cents: number | null | undefined): string {
  return cents === null || cents === undefined || !Number.isFinite(cents) ? '—' : brl.format(cents / 100);
}

export function formatMoneyCompact(cents: number | null | undefined): string {
  return cents === null || cents === undefined || !Number.isFinite(cents) ? '—' : brlCompact.format(cents / 100);
}

/** Percentual com duas casas; `null` (sem dados) vira "—", nunca "0%". */
export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${pct.format(value)}%`;
}

export function formatQuantity(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : qtyFmt.format(n);
}

/** Dias (média) com uma casa: "3,5 dias". */
export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} ${value === 1 ? 'dia' : 'dias'}`;
}

/**
 * Lê valor em reais digitado ("1.234,56", "1234,5", "1234.56", "R$ 10") e devolve CENTAVOS inteiros, sem usar ponto
 * flutuante. `null` se não for um valor válido. Recusa mais de 2 casas decimais.
 */
export function parseMoneyToCents(input: string): number | null {
  const raw = input.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (raw === '') return null;
  let normalized: string;
  if (raw.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$|^\d{1,3}(\.\d{3})+,$|^\d+,$/.test(raw)) return null;
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, '');
  } else if (/^\d+(\.\d{1,2})?$/.test(raw)) {
    normalized = raw;
  } else {
    return null;
  }
  const [int, frac = ''] = normalized.split('.');
  const cents = BigInt(int!) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
  return cents > 99_999_999_999n ? null : Number(cents);
}

/** Centavos -> texto de campo ("1234,56"), para preencher formulários. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const abs = Math.abs(Math.trunc(cents));
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Quantidade ou percentual digitado ("2,5" ou "2.5") -> texto decimal canônico ("2.5"); `null` se inválido. */
export function parseDecimalText(input: string, maxScale: number): string | null {
  const raw = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [int, frac = ''] = raw.split('.');
  const trimmed = frac.replace(/0+$/, '');
  if (trimmed.length > maxScale) return null;
  return trimmed ? `${int}.${trimmed}` : int!;
}

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' sem deslocamento de fuso. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: TZ });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ });
export function formatDateBR(value: string | null | undefined): string {
  return value ? dateOnly.format(new Date(value)) : '—';
}
export function formatDateTimeBR(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

/** Número de proposta com versão: "00045 · v2". */
export const proposalLabel = (number: string, version?: number | null) => (version ? `${number} · v${version}` : number);

/** CPF (11 dígitos) ou CNPJ (14) formatado; outro formato volta como está. */
export function formatDocument(value: string | null | undefined): string {
  const d = (value ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value ?? '';
}

/** Valida CPF/CNPJ pelos dígitos verificadores. Documento é opcional: vazio é válido. */
export function isValidDocument(value: string | null | undefined): boolean {
  const d = (value ?? '').replace(/\D/g, '');
  if (d === '') return true;
  if (/^(\d)\1+$/.test(d)) return false;
  const digit = (base: string, weights: number[]) => {
    const sum = weights.reduce((s, w, i) => s + Number(base[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 11) {
    const a = digit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const b = digit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return a === Number(d[9]) && b === Number(d[10]);
  }
  if (d.length === 14) {
    const a = digit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const b = digit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return a === Number(d[12]) && b === Number(d[13]);
  }
  return false;
}
