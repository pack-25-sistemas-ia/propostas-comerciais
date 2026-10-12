// Motor de cálculo comercial (espelho TypeScript de public.prop_compute, no banco).
// O BANCO é a fonte de verdade (calcula e grava); este módulo existe para o editor mostrar os totais
// em tempo real e para os testes provarem que os dois dão exatamente o mesmo resultado (mesmas fixtures).
// Ordem e arredondamento: docs/METRICS.md §Precificação. Tudo em inteiros (BigInt), nunca ponto flutuante.

export type DiscountKind = 'none' | 'percent' | 'fixed';
export type Decimalish = string | number;

export type PricingItemInput = {
  quantity: Decimalish;
  unit_price_cents: Decimalish;
  discount_kind?: DiscountKind;
  discount_value?: Decimalish;
};
export type PricingDiscountInput = { kind: DiscountKind; value: Decimalish };
export type PricingChargeInput = { label: string; kind: 'percent' | 'fixed'; value: Decimalish };

export type PricingItemResult = { gross_cents: number; discount_cents: number; total_cents: number };
export type PricingChargeResult = { label: string; kind: 'percent' | 'fixed'; value: number; amount_cents: number };
export type PricingResult = {
  items: PricingItemResult[];
  gross_cents: number;
  items_discount_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  base_cents: number;
  charges: PricingChargeResult[];
  additional_charges_cents: number;
  total_cents: number;
};

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

const MAX_CENTS = 99_999_999_999n;
const MAX_QTY = 99_999_999n;
const MAX_ITEMS = 200;
const MAX_CHARGES = 10;
const QTY_SCALE = 4;
const PCT_SCALE = 2;

/** Texto decimal -> inteiro com `scale` casas. Recusa mais casas que `scale` (zeros à direita não contam) e números fora do padrão. */
function toScaled(value: Decimalish | undefined | null, scale: number, error: string): bigint {
  if (value === undefined || value === null) throw new PricingError(error);
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new PricingError(error);
  const frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac.length > scale) throw new PricingError(error);
  const n = BigInt(m[2] + frac.padEnd(scale, '0'));
  return m[1] === '-' && n !== 0n ? -n : n;
}

/** Arredondamento do meio para cima, para numerador >= 0: floor(num/den + 1/2). */
const roundDiv = (num: bigint, den: bigint): bigint => (num * 2n + den) / (2n * den);

const pow10 = (n: number): bigint => 10n ** BigInt(n);

function percentOf(base: bigint, pctScaled: bigint): bigint {
  return roundDiv(base * pctScaled, 100n * pow10(PCT_SCALE));
}

function decimalToNumber(scaled: bigint, scale: number): number {
  return Number(scaled) / 10 ** scale;
}

export function computePricing(
  items: PricingItemInput[],
  discount: PricingDiscountInput = { kind: 'none', value: 0 },
  charges: PricingChargeInput[] = [],
): PricingResult {
  if (items.length > MAX_ITEMS || charges.length > MAX_CHARGES) throw new PricingError('itens ou encargos demais');

  let sumGross = 0n;
  let sumItemDiscount = 0n;
  let subtotal = 0n;
  const itemsOut: PricingItemResult[] = [];

  for (const it of items) {
    const qty = toScaled(it.quantity, QTY_SCALE, 'item com número inválido');
    const price = toScaled(it.unit_price_cents, 0, 'preço inválido');
    if (qty <= 0n || qty > MAX_QTY * pow10(QTY_SCALE)) throw new PricingError('quantidade inválida');
    if (price < 0n || price > MAX_CENTS) throw new PricingError('preço inválido');
    const gross = roundDiv(qty * price, pow10(QTY_SCALE));
    const kind = it.discount_kind ?? 'none';
    let disc: bigint;
    if (kind === 'none') {
      disc = 0n;
    } else if (kind === 'percent') {
      const pct = toScaled(it.discount_value ?? 0, PCT_SCALE, 'desconto percentual inválido');
      if (pct < 0n || pct > 100n * pow10(PCT_SCALE)) throw new PricingError('desconto percentual inválido');
      disc = percentOf(gross, pct);
    } else if (kind === 'fixed') {
      disc = toScaled(it.discount_value ?? 0, 0, 'desconto fixo inválido');
      if (disc < 0n) throw new PricingError('desconto fixo inválido');
    } else {
      throw new PricingError('tipo de desconto inválido');
    }
    if (disc > gross) disc = gross;
    const net = gross - disc;
    sumGross += gross;
    sumItemDiscount += disc;
    subtotal += net;
    itemsOut.push({ gross_cents: Number(gross), discount_cents: Number(disc), total_cents: Number(net) });
  }

  let globalDiscount = 0n;
  if (discount.kind === 'percent') {
    const pct = toScaled(discount.value, PCT_SCALE, 'desconto global inválido');
    if (pct < 0n || pct > 100n * pow10(PCT_SCALE)) throw new PricingError('desconto global inválido');
    globalDiscount = percentOf(subtotal, pct);
  } else if (discount.kind === 'fixed') {
    globalDiscount = toScaled(discount.value, 0, 'desconto global inválido');
    if (globalDiscount < 0n) throw new PricingError('desconto global inválido');
  } else if (discount.kind !== 'none') {
    throw new PricingError('tipo de desconto global inválido');
  }
  if (globalDiscount > subtotal) globalDiscount = subtotal;
  const base = subtotal - globalDiscount;

  let sumCharges = 0n;
  const chargesOut: PricingChargeResult[] = [];
  for (const ch of charges) {
    const label = (ch.label ?? '').trim();
    if (label.length < 1 || label.length > 60) throw new PricingError('encargo inválido');
    let amount: bigint;
    let shown: number;
    if (ch.kind === 'percent') {
      const pct = toScaled(ch.value, PCT_SCALE, 'encargo inválido');
      if (pct < 0n || pct > 100n * pow10(PCT_SCALE)) throw new PricingError('encargo inválido');
      amount = percentOf(base, pct);
      shown = decimalToNumber(pct, PCT_SCALE);
    } else if (ch.kind === 'fixed') {
      amount = toScaled(ch.value, 0, 'encargo inválido');
      if (amount < 0n || amount > MAX_CENTS) throw new PricingError('encargo inválido');
      shown = Number(amount);
    } else {
      throw new PricingError('encargo inválido');
    }
    sumCharges += amount;
    chargesOut.push({ label, kind: ch.kind, value: shown, amount_cents: Number(amount) });
  }

  const total = base + sumCharges;
  if (total > MAX_CENTS) throw new PricingError('valor total acima do limite');
  return {
    items: itemsOut,
    gross_cents: Number(sumGross),
    items_discount_cents: Number(sumItemDiscount),
    subtotal_cents: Number(subtotal),
    discount_cents: Number(globalDiscount),
    base_cents: Number(base),
    charges: chargesOut,
    additional_charges_cents: Number(sumCharges),
    total_cents: Number(total),
  };
}

/** Desconto total concedido como % do bruto (itens + global); usado para o limite por perfil. `null` se o bruto for zero. */
export function totalDiscountPct(result: Pick<PricingResult, 'gross_cents' | 'items_discount_cents' | 'discount_cents'>): number | null {
  if (result.gross_cents <= 0) return null;
  return ((result.items_discount_cents + result.discount_cents) * 100) / result.gross_cents;
}
