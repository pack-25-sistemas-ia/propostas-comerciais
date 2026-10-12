'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { decideProposal } from '@/lib/proposals/actions';

/** Aceite ou recusa pelo cliente. Confirmação comercial simples (não é assinatura eletrônica certificada). */
export function DecisionForm({ token, companyName }: { token: string; companyName: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<'accepted' | 'declined'>('accepted');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState<{ ok?: boolean; message?: string; errors?: Record<string, string[]> }>({});
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    const r = await decideProposal(token, { decision, name, email, comment, confirm });
    if (r.ok) { setState({ ok: true, message: r.decision === 'accepted' ? 'Proposta aceita. Obrigado!' : 'Resposta registrada. Obrigado pelo retorno.' }); router.refresh(); return; }
    setState({ ok: false, message: r.message, errors: r.fieldErrors });
  });

  if (state.ok) return <Alert tone="success">{state.message}</Alert>;
  const err = (k: string) => state.errors?.[k];
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4" noValidate aria-label="Responder à proposta">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Sua resposta</legend>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="decision" className="size-4" checked={decision === 'accepted'} onChange={() => setDecision('accepted')} />Aceitar a proposta</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="decision" className="size-4" checked={decision === 'declined'} onChange={() => setDecision('declined')} />Recusar a proposta</label>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Seu nome" name="decision-name" errors={err('name')}><Input id="decision-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={Boolean(err('name'))} /></Field>
        <Field label="Seu e-mail" name="decision-email" errors={err('email')}><Input id="decision-email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={Boolean(err('email'))} /></Field>
      </div>
      <Field label={decision === 'declined' ? 'Motivo (opcional)' : 'Comentário (opcional)'} name="decision-comment" errors={err('comment')}><Textarea id="decision-comment" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></Field>
      <div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>Li a proposta e confirmo esta resposta em nome de quem represento perante {companyName}.</span></label>
        {err('confirm') ? <p role="alert" className="mt-1 text-xs text-danger">{err('confirm')?.[0]}</p> : null}
      </div>
      {state.message && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? 'Enviando…' : decision === 'accepted' ? 'Confirmar aceite' : 'Confirmar recusa'}</Button>
      <p className="text-xs text-muted">Esta resposta é uma confirmação comercial simples, registrada com data e hora. Não é assinatura eletrônica certificada.</p>
    </form>
  );
}
