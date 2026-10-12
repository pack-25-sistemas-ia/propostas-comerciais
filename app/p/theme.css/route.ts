import { NextResponse } from 'next/server';

// Folha de estilo do tema do DOCUMENTO (cores da empresa na proposta). Do próprio domínio, para valer sob a CSP
// estrita (`style-src 'self'`). Pública (/p/ é prefixo público) e sem dados sensíveis: só duas cores.
// Define uma classe por par de cores: .doc-theme-<primária>-<secundária>.
const HEX = /^[0-9A-Fa-f]{6}$/;

function luminance(hex: string): number {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const p = (url.searchParams.get('p') ?? '').toUpperCase();
  const s = (url.searchParams.get('s') ?? '').toUpperCase();
  const primary = HEX.test(p) ? p : '162A43';
  const secondary = HEX.test(s) ? s : '22D3EE';
  const onPrimary = luminance(primary) > 0.4 ? '#0B1220' : '#FFFFFF';
  // cor secundária usada como TEXTO precisa de contraste sobre fundo branco: escurece se for clara
  const secondaryInk = luminance(secondary) > 0.35 ? '#0E7490' : `#${secondary}`;
  const css = `.doc-theme-${primary}-${secondary}{--doc-primary:#${primary};--doc-secondary:#${secondary};--doc-secondary-ink:${secondaryInk};--doc-on-primary:${onPrimary};--doc-ink:#0B1220;--doc-muted:#475569;--doc-line:#CBD5E1}`;
  return new NextResponse(css, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' } });
}
