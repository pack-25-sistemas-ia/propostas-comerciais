import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Alert, Card } from '@/components/ui/primitives';
import { DecisionForm } from '@/components/proposals/decision-form';
import { DocumentView, docThemeHref } from '@/components/proposals/document-view';
import { formatDate, formatDateTimeBR } from '@/lib/proposals/format';
import { fetchPublicProposal } from '@/lib/proposals/public';
import { rateLimit } from '@/lib/security/rate-limit';

// Página pública do cliente: sem login, só com o link. Nunca usa a sessão; fala com o banco só pelas funções públicas.
// Não indexável e sem enviar o endereço (token) como referência para outros sites.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Proposta', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

/** Heurística: prévias de mensageiros, robôs e prefetch não contam como "visualização" do cliente. */
function looksHuman(h: Headers): boolean {
  if ((h.get('purpose') ?? h.get('sec-purpose') ?? '').toLowerCase().includes('prefetch')) return false;
  const ua = (h.get('user-agent') ?? '').toLowerCase();
  if (!ua) return false;
  return !/bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|linkedinbot|twitterbot|curl|wget|python-requests|go-http-client|okhttp/.test(ua);
}

function Unavailable({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4 py-10">
      <Card><h1 className="text-lg font-semibold">{title}</h1><p className="mt-2 text-sm text-muted">{text}</p></Card>
    </main>
  );
}

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'desconhecido';
  if (!rateLimit(`view:${ip}`, { limit: 60, windowMs: 60_000 }).allowed) {
    return <Unavailable title="Muitas tentativas" text="Aguarde um minuto e tente de novo." />;
  }
  const view = await fetchPublicProposal(token, looksHuman(h));

  if (view.state === 'unavailable') return <Unavailable title="Link indisponível" text="Este link não existe, foi revogado ou venceu. Peça um novo link a quem enviou a proposta." />;
  if (view.state === 'cancelled') return <Unavailable title="Proposta cancelada" text="Esta proposta foi cancelada por quem a enviou." />;
  if (view.state === 'superseded') return <Unavailable title="Existe uma versão mais recente" text="Esta versão da proposta foi substituída. Peça o novo link a quem enviou." />;
  const snap = view.snapshot;
  if (!snap) return <Unavailable title="Link indisponível" text="Não foi possível abrir esta proposta." />;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <link rel="stylesheet" href={docThemeHref(snap.company.primary_color, snap.company.secondary_color)} precedence="doc-theme" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-sm font-medium text-muted">Proposta {snap.proposal.number} · {snap.company.name}</h1>
        <a className="inline-flex min-h-10 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href={`/p/${token}/pdf`}>Baixar PDF</a>
      </div>

      {view.state === 'expired' ? <div className="mb-4"><Alert tone="warning">Esta proposta venceu em {formatDate(view.validUntil)} e não pode mais ser aceita. Peça uma nova versão a quem enviou.</Alert></div> : null}
      {view.state === 'decided' && view.decision ? (
        <div className="mb-4"><Alert tone={view.decision.decision === 'accepted' ? 'success' : 'info'}>
          {view.decision.decision === 'accepted' ? 'Proposta aceita' : 'Proposta recusada'} em {formatDateTimeBR(view.decision.decidedAt)}. Obrigado pelo retorno.
        </Alert></div>
      ) : null}

      <DocumentView snapshot={snap} />

      {view.state === 'open' ? (
        <section className="mt-8" aria-label="Responder à proposta">
          <Card title="Responder à proposta" description={`Válida até ${formatDate(view.validUntil)}.`}>
            <DecisionForm token={token} companyName={snap.company.name} />
          </Card>
        </section>
      ) : null}
    </main>
  );
}
