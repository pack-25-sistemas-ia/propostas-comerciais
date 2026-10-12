import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PricingError, computePricing, totalDiscountPct, type PricingChargeInput, type PricingDiscountInput, type PricingItemInput } from '@/lib/proposals/pricing';

type ValidCase = { name: string; items: PricingItemInput[]; discount?: PricingDiscountInput; charges?: PricingChargeInput[]; expected: unknown };
type InvalidCase = { name: string; items: PricingItemInput[]; discount?: PricingDiscountInput; charges?: PricingChargeInput[] };
const root = process.cwd();
const fixtures = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'pricing-cases.json'), 'utf8')) as { valid: ValidCase[]; invalid: InvalidCase[] };

describe('motor de cálculo — fixtures calculadas à mão (as mesmas do SQL)', () => {
  for (const c of fixtures.valid) {
    it(c.name, () => {
      expect(computePricing(c.items, c.discount, c.charges)).toEqual(c.expected);
    });
  }
  for (const c of fixtures.invalid) {
    it(`recusa: ${c.name}`, () => {
      expect(() => computePricing(c.items, c.discount, c.charges)).toThrow(PricingError);
    });
  }
  it('o SQL de teste gerado a partir das fixtures está em dia', () => {
    const out = execFileSync(process.execPath, [join(root, 'scripts', 'gen-pricing-sql.mjs'), '--check'], { encoding: 'utf8' });
    expect(out).toContain('em dia');
  });
});

describe('motor de cálculo — propriedades', () => {
  // gerador pseudoaleatório determinístico (xorshift)
  let seed = 123456789;
  const rnd = (n: number) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return Math.abs(seed) % n;
  };
  const randomCase = () => {
    const items: PricingItemInput[] = Array.from({ length: 1 + rnd(6) }, () => {
      const kind = (['none', 'percent', 'fixed'] as const)[rnd(3)];
      return {
        quantity: `${1 + rnd(50)}.${String(rnd(10000)).padStart(4, '0')}`,
        unit_price_cents: rnd(2_000_000),
        discount_kind: kind,
        discount_value: kind === 'percent' ? `${rnd(101)}.${String(rnd(100)).padStart(2, '0')}`.replace(/^100\.\d+$/, '100') : String(rnd(500_000)),
      };
    });
    const discount: PricingDiscountInput = rnd(2) ? { kind: 'percent', value: `${rnd(60)}.${String(rnd(100)).padStart(2, '0')}` } : { kind: 'fixed', value: String(rnd(300_000)) };
    const charges: PricingChargeInput[] = rnd(2) ? [{ label: 'Taxa', kind: 'percent', value: `${rnd(20)}.${String(rnd(100)).padStart(2, '0')}` }, { label: 'Frete', kind: 'fixed', value: String(rnd(50_000)) }] : [];
    return { items, discount, charges };
  };

  it('invariantes: soma dos itens, base, encargos e total; nada negativo; desconto nunca passa do bruto', () => {
    for (let i = 0; i < 400; i++) {
      const { items, discount, charges } = randomCase();
      const r = computePricing(items, discount, charges);
      expect(r.items.reduce((s, x) => s + x.total_cents, 0)).toBe(r.subtotal_cents);
      expect(r.items.reduce((s, x) => s + x.gross_cents, 0)).toBe(r.gross_cents);
      expect(r.items.reduce((s, x) => s + x.discount_cents, 0)).toBe(r.items_discount_cents);
      expect(r.subtotal_cents).toBe(r.gross_cents - r.items_discount_cents);
      expect(r.base_cents).toBe(r.subtotal_cents - r.discount_cents);
      expect(r.total_cents).toBe(r.base_cents + r.additional_charges_cents);
      expect(r.charges.reduce((s, x) => s + x.amount_cents, 0)).toBe(r.additional_charges_cents);
      for (const x of r.items) {
        expect(x.discount_cents).toBeLessThanOrEqual(x.gross_cents);
        expect(x.total_cents).toBeGreaterThanOrEqual(0);
      }
      expect(r.discount_cents).toBeLessThanOrEqual(r.subtotal_cents);
      expect(r.total_cents).toBeGreaterThanOrEqual(0);
    }
  });

  it('é determinístico e não depende da ordem dos encargos (somas) nem muda ao recalcular', () => {
    const { items, discount, charges } = randomCase();
    const a = computePricing(items, discount, charges);
    expect(computePricing(items, discount, charges)).toEqual(a);
    if (charges.length === 2) expect(computePricing(items, discount, [...charges].reverse()).total_cents).toBe(a.total_cents);
  });

  it('aceita números JS e textos equivalentes (10 = "10" = "10.0000")', () => {
    const a = computePricing([{ quantity: 10, unit_price_cents: 1999, discount_kind: 'percent', discount_value: 12.5 }]);
    const b = computePricing([{ quantity: '10.0000', unit_price_cents: '1999', discount_kind: 'percent', discount_value: '12.50' }]);
    expect(a).toEqual(b);
  });

  it('percentual do desconto total para o limite por perfil', () => {
    const r = computePricing([{ quantity: '1', unit_price_cents: 10000, discount_kind: 'fixed', discount_value: '1000' }]);
    expect(totalDiscountPct(r)).toBe(10);
    expect(totalDiscountPct(computePricing([]))).toBeNull();
  });

  it('valor grande não perde precisão (acima de 2^31 centavos)', () => {
    const r = computePricing([{ quantity: '3', unit_price_cents: 33_333_333_333 }]);
    expect(r.total_cents).toBe(99_999_999_999);
  });
});
