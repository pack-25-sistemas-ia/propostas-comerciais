import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import type { Snapshot } from '@/lib/proposals/snapshot';
import { ProposalPdf } from './document';

/** PDF A4 da revisão (a partir do snapshot imutável). */
export async function renderProposalPdf(snapshot: Snapshot, draft = false): Promise<Buffer> {
  return renderToBuffer(<ProposalPdf snapshot={snapshot} draft={draft} />);
}

/** Nome de arquivo seguro: "Proposta-00045-v2.pdf". */
export function pdfFileName(number: string, version: number): string {
  return `Proposta-${number.replace(/[^A-Za-z0-9-]/g, '')}-v${version}.pdf`;
}
