'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ActionButton } from '@/components/app/form-kit';
import { Alert, Button, Textarea } from '@/components/ui/primitives';
import { archiveProposal, cancelProposal, createRevision, duplicateProposal } from '@/lib/proposals/actions';
import type { ProposalStatus } from '@/lib/proposals/filters';

type Props = {
  proposalId: string;
  status: ProposalStatus;
  canWrite: boolean;
  /** a revisão vigente ainda é rascunho (pode ser editada) */
  draftRevision: boolean;
  archived: boolean;
  /** revisão exibida (para o PDF) */
  revisionId: string | null;
};

const link = 'inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';

export function ProposalActions({ proposalId, status, canWrite, draftRevision, archived, revisionId }: Props) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closed = status === 'accepted' || status === 'cancelled';
  const idOf = (r: unknown) => (r as { id?: string }).id;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {revisionId ? <a className={link} href={`/propostas/${proposalId}/pdf?rev=${revisionId}`}>Baixar PDF</a> : null}
        {canWrite && draftRevision && !closed ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" href={`/propostas/${proposalId}/editar`}>Editar rascunho</Link> : null}
        {canWrite && !draftRevision && !closed && !archived ? (
          <ActionButton label="Criar nova revisão" pendingLabel="Criando…" action={() => createRevision(proposalId)} onDone={() => router.push(`/propostas/${proposalId}/editar`)} />
        ) : null}
        {canWrite ? <ActionButton label="Duplicar" pendingLabel="Duplicando…" action={() => duplicateProposal(proposalId)} onDone={(r) => { const id = idOf(r); if (id) router.push(`/propostas/${id}/editar`); }} /> : null}
        {canWrite && !closed ? <Button type="button" variant="secondary" onClick={() => setCancelOpen((o) => !o)} aria-expanded={cancelOpen}>Cancelar proposta</Button> : null}
        {canWrite ? <ActionButton label={archived ? 'Restaurar' : 'Arquivar'} action={() => archiveProposal(proposalId, !archived)} confirm={archived ? undefined : 'Arquivar esta proposta? Ela sai das listas e dos indicadores, mas pode ser restaurada.'} /> : null}
      </div>
      {cancelOpen ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <label htmlFor="cancel-reason" className="text-sm font-medium">Motivo do cancelamento (opcional)</label>
          <Textarea id="cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-muted">Todos os links de compartilhamento serão revogados e a proposta não poderá mais ser aceita.</p>
          <div className="flex gap-2">
            <Button type="button" variant="danger" disabled={pending} onClick={() => start(async () => {
              const r = await cancelProposal(proposalId, reason);
              setMsg(r.message ?? null);
              if (r.ok) { setCancelOpen(false); router.refresh(); }
            })}>{pending ? 'Cancelando…' : 'Confirmar cancelamento'}</Button>
            <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>Voltar</Button>
          </div>
        </div>
      ) : null}
      {msg && !cancelOpen ? <Alert tone="info">{msg}</Alert> : null}
    </div>
  );
}
