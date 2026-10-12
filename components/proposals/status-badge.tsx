import { Badge } from '@/components/ui/primitives';
import { STATUS_LABELS, type ProposalStatus } from '@/lib/proposals/filters';

const TONE: Record<ProposalStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', sent: 'warning', viewed: 'warning', accepted: 'success', declined: 'danger', expired: 'danger', cancelled: 'neutral',
};

/** Status da proposta. O texto sempre acompanha a cor (não depende só da cor). */
export function StatusBadge({ status }: { status: ProposalStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABELS[status]}</Badge>;
}
