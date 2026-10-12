import { formatDateTimeBR } from '@/lib/proposals/format';
import type { EventRow } from '@/lib/proposals/data';

const LABELS: Record<string, (e: EventRow) => string> = {
  created: (e) => (e.metadata.duplicated_from ? `Proposta criada a partir da ${String(e.metadata.duplicated_from)}` : 'Proposta criada'),
  revised: (e) => `Nova revisão criada${e.metadata.version ? ` (versão ${String(e.metadata.version)})` : ''}`,
  published: (e) => `Versão ${String(e.metadata.version ?? '')} publicada`.replace('  ', ' '),
  sent: () => 'Primeiro envio ao cliente',
  link_created: () => 'Link de compartilhamento criado',
  link_revoked: () => 'Link de compartilhamento revogado',
  viewed: () => 'Aberta pelo cliente (visualização)',
  accepted: () => 'Aceita pelo cliente',
  declined: () => 'Recusada pelo cliente',
  expired: () => 'Expirou por validade',
  cancelled: (e) => `Cancelada${e.metadata.reason ? `: ${String(e.metadata.reason)}` : ''}`,
  email: () => 'E-mail registrado',
};

/** Histórico em ordem cronológica inversa. A contagem de visualizações não é medida exata (prévias de mensageiros podem contar). */
export function Timeline({ events }: { events: EventRow[] }) {
  if (events.length === 0) return <p className="text-sm text-muted">Sem eventos.</p>;
  return (
    <ol className="space-y-3 border-l border-border pl-4" aria-label="Histórico da proposta">
      {events.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" />
          <p className="font-medium">{(LABELS[e.event_type] ?? (() => e.event_type))(e)}</p>
          <p className="text-xs text-muted">{formatDateTimeBR(e.created_at)}{e.actor_id ? '' : e.event_type === 'viewed' || e.event_type === 'accepted' || e.event_type === 'declined' ? ' · pelo link' : ''}</p>
        </li>
      ))}
    </ol>
  );
}
