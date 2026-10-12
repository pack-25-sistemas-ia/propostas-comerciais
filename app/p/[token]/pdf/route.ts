import { NextResponse } from 'next/server';
import { fetchPublicProposal } from '@/lib/proposals/public';
import { pdfFileName, renderProposalPdf } from '@/lib/proposals/pdf/render';
import { rateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

const gone = () => new NextResponse('Link indisponível.', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

/** PDF da revisão pelo link público. Sem sessão; resposta idêntica (404) para link inválido, revogado ou vencido. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'desconhecido';
  if (!rateLimit(`pdf:${ip}`, { limit: 20, windowMs: 10 * 60_000 }).allowed) {
    return new NextResponse('Muitas tentativas. Aguarde alguns minutos.', { status: 429, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' } });
  }
  // não é uma "visualização humana": baixar o PDF não muda o status
  const view = await fetchPublicProposal(token, false);
  if (!view.snapshot || !['open', 'decided', 'expired'].includes(view.state)) return gone();
  const pdf = await renderProposalPdf(view.snapshot);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(view.snapshot.proposal.number, view.snapshot.revision.version)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  });
}
