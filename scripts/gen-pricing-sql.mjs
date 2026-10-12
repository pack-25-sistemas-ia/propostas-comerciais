#!/usr/bin/env node
// Gera supabase/tests/60_prop_pricing_fixtures.sql a partir de tests/fixtures/pricing-cases.json.
// As MESMAS fixtures alimentam o motor TypeScript (tests/unit). Um teste unitário garante que o SQL gerado está em dia.
// Uso: node scripts/gen-pricing-sql.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'pricing-cases.json'), 'utf8'));
const out = join(root, 'supabase', 'tests', '60_prop_pricing_fixtures.sql');
const j = (v) => `$j$${JSON.stringify(v)}$j$::jsonb`;
const q = (s) => `$m$${s}$m$`;

export function render() {
  const lines = [
    '-- GERADO por scripts/gen-pricing-sql.mjs a partir de tests/fixtures/pricing-cases.json. NÃO edite à mão.',
    '-- Motor de cálculo (prop_compute): resultados esperados calculados à mão; o TypeScript usa as mesmas fixtures.',
    '',
    'do $$',
    'begin',
  ];
  for (const c of cases.valid) {
    lines.push(`  assert public.prop_compute(${j(c.items)}, ${j(c.discount ?? { kind: 'none', value: 0 })}, ${j(c.charges ?? [])}) = ${j(c.expected)}, ${q('cálculo: ' + c.name)};`);
  }
  for (const c of cases.invalid) {
    const call = `select public.prop_compute(${j(c.items)}, ${j(c.discount ?? { kind: 'none', value: 0 })}, ${j(c.charges ?? [])})`;
    lines.push(`  assert test.throws($q$${call}$q$), ${q('deve recusar: ' + c.name)};`);
  }
  lines.push(`  raise notice 'PASS: motor de cálculo — ${cases.valid.length} fixtures válidas e ${cases.invalid.length} inválidas';`, 'end $$;', '');
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = render();
  if (process.argv.includes('--check')) {
    const cur = (() => { try { return readFileSync(out, 'utf8'); } catch { return ''; } })();
    if (cur !== text) { console.error('60_prop_pricing_fixtures.sql desatualizado: rode node scripts/gen-pricing-sql.mjs'); process.exit(1); }
    console.log('fixtures SQL em dia');
  } else {
    writeFileSync(out, text);
    console.log('gerado', out);
  }
}
