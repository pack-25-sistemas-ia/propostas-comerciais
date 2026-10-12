import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveContext } from '@/lib/auth/session';
import { getProposal } from '@/lib/proposals/data';
import { documentForRevision } from '@/lib/proposals/detail-snapshot';
import { pdfFileName, renderProposalPdf } from '@/lib/proposals/pdf/render';

export const runtime = 'nodejs';

const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * PDF de uma revisão. Publicada: gerado do snapshot imutável (sempre idêntico). Rascunho: gerado do estado salvo,
 * com a faixa "RASCUNHO". Proposta incompleta NÃO gera PDF (devolve o motivo). Acesso: o RLS decide o que o usuário vê.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveContext();
  if (auth.kind !== 'ok') return json('Sessão inválida.', 401);
  const { ctx } = auth;
  const { id } = await params;
  const rev = new URL(request.url).searchParams.get('rev');
  if (!z.uuid().safeParse(id).success || (rev !== null && !z.uuid().safeParse(rev).success)) return json('Identificador inválido.', 400);

  const detail = await getProposal(ctx, id, rev);
  if (!detail || !detail.current) return json('Proposta não encontrada.', 404);
  if (rev && detail.current.id !== rev) return json('Revisão não encontrada.', 404);

  const doc = await documentForRevision(ctx, detail);
  if (!doc.ok) return json(doc.error, doc.status);

  const pdf = await renderProposalPdf(doc.snapshot, doc.draft);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(detail.proposal.proposal_number, detail.current.version_number)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
