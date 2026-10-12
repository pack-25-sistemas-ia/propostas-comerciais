'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ActionButton } from '@/components/app/form-kit';
import { Alert, Badge, Button, Card, Input, Select } from '@/components/ui/primitives';
import { createShareLink, revokeShareLink, sendProposalEmail } from '@/lib/proposals/actions';
import { formatDateTimeBR } from '@/lib/proposals/format';
import type { EmailRow, LinkRow } from '@/lib/proposals/data';

type Props = {
  proposalId: string;
  canShare: boolean;
  /** só propostas enviadas/visualizadas geram link */
  shareable: boolean;
  publishedRevisionId: string | null;
  links: LinkRow[];
  emails: EmailRow[];
  defaultEmail: string;
  nowIso: string;
};

const EMAIL_LABEL: Record<EmailRow['delivery_status'], string> = { sent: 'Enviado ao provedor', failed: 'Falhou', not_configured: 'Não enviado (e-mail não configurado)' };

function linkState(l: LinkRow, publishedRevisionId: string | null, nowIso: string): { label: string; tone: 'success' | 'neutral' | 'danger'; active: boolean } {
  if (l.revoked_at) return { label: 'Revogado', tone: 'danger', active: false };
  if (l.expires_at <= nowIso) return { label: 'Vencido', tone: 'neutral', active: false };
  if (l.revision_id !== publishedRevisionId) return { label: 'Versão antiga', tone: 'neutral', active: false };
  return { label: 'Ativo', tone: 'success', active: true };
}

export function SharePanel({ proposalId, canShare, shareable, publishedRevisionId, links, emails, defaultEmail, nowIso }: Props) {
  const router = useRouter();
  const [days, setDays] = useState('30');
  const [created, setCreated] = useState<{ url: string; message: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  const [pending, start] = useTransition();

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setError('Não foi possível copiar automaticamente: selecione o link e copie.'); }
  };

  return (
    <Card title="Compartilhamento" description="O cliente abre a proposta por um link seguro, sem login, e pode aceitar ou recusar.">
      {!shareable ? <Alert tone="info">Publique a proposta para gerar o link de compartilhamento.</Alert> : null}
      {shareable && canShare ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="link-days" className="mb-1.5 block text-sm font-medium">Link válido por</label>
              <Select id="link-days" value={days} onChange={(e) => setDays(e.target.value)} className="w-40">
                <option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option>
              </Select>
            </div>
            <Button type="button" disabled={pending} onClick={() => start(async () => {
              setError(null); setCopied(false);
              const r = await createShareLink(proposalId, Number(days));
              if (!r.ok || !r.url) { setError(r.message ?? 'Não foi possível criar o link.'); return; }
              setCreated({ url: r.url, message: r.message ?? '', ok: true });
              router.refresh();
            })}>{pending ? 'Criando…' : 'Criar link'}</Button>
          </div>

          {created ? (
            <div className="space-y-2 rounded-lg border border-border bg-background p-3" role="status">
              <p className="text-sm font-medium">{created.message}</p>
              <div className="flex flex-wrap gap-2">
                <Input readOnly aria-label="Link da proposta" value={created.url} onFocus={(e) => e.currentTarget.select()} className="min-w-64 flex-1" />
                <Button type="button" variant="secondary" onClick={() => void copy(created.url)}>{copied ? 'Copiado!' : 'Copiar link'}</Button>
              </div>
            </div>
          ) : null}

          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null); setCreated(null);
              const r = await sendProposalEmail({ proposal_id: proposalId, to: email });
              if (r.url) setCreated({ url: r.url, message: r.message ?? '', ok: Boolean(r.ok) });
              else setError(r.message ?? 'Não foi possível enviar.');
              router.refresh();
            });
          }}>
            <label htmlFor="send-email" className="block text-sm font-medium">Enviar por e-mail</label>
            <div className="flex flex-wrap gap-2">
              <Input id="send-email" type="email" required placeholder="cliente@empresa.com.br" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-64 flex-1" />
              <Button type="submit" variant="secondary" disabled={pending}>Enviar e-mail</Button>
            </div>
            <p className="text-xs text-muted">Se o envio de e-mail não estiver configurado neste ambiente, nada é enviado: o sistema avisa e mostra o link para você compartilhar à mão.</p>
          </form>
          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>
      ) : null}

      {links.length > 0 ? (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Links criados</h3>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {links.map((l) => {
              const st = linkState(l, publishedRevisionId, nowIso);
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>Criado em {formatDateTimeBR(l.created_at)} · expira em {formatDateTimeBR(l.expires_at)}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {canShare && st.active ? <ActionButton label="Revogar" confirm="Revogar este link? Quem o tiver não conseguirá mais abrir a proposta." action={() => revokeShareLink(l.id, proposalId)} /> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">Por segurança o endereço completo só aparece quando o link é criado. Se perdeu, crie outro e revogue o antigo.</p>
        </div>
      ) : null}

      {emails.length > 0 ? (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Tentativas de envio por e-mail</h3>
          <ul className="space-y-1 text-sm">
            {emails.map((m) => <li key={m.id}>{formatDateTimeBR(m.attempted_at)} · {m.recipient_email} · <span className={m.delivery_status === 'failed' ? 'text-danger' : ''}>{EMAIL_LABEL[m.delivery_status]}</span>{m.error_message ? ` — ${m.error_message}` : ''}</li>)}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
