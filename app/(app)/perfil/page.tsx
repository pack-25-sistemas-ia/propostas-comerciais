import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/primitives';
import { requireContext } from '@/lib/auth/session';
import { ROLE_LABELS } from '@/lib/validation/org';

export const metadata: Metadata = { title: 'Perfil' };

export default async function ProfilePage() {
  const ctx = await requireContext();
  return (
    <>
      <PageHeader title="Perfil" description="Sua conta e suas organizações." />
      <div className="space-y-6">
        <Card title="Conta">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">E-mail</dt><dd className="font-medium">{ctx.user.email}</dd></div>
            <div><dt className="text-muted">Papel nesta organização</dt><dd className="font-medium">{ROLE_LABELS[ctx.membership.role]}</dd></div>
          </dl>
          <p className="mt-4 text-sm"><Link className="underline underline-offset-2" href="/forgot-password">Redefinir minha senha</Link> · <Link className="underline underline-offset-2" href="/mfa/enroll">Verificação em duas etapas</Link></p>
        </Card>
        <Card title="Organizações">
          <ul className="divide-y divide-border text-sm">
            {ctx.memberships.map((m) => (
              <li key={m.organization_id} className="flex items-center justify-between gap-2 py-2"><span className="font-medium">{m.name}</span><span className="text-muted">{ROLE_LABELS[m.role]}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Para trocar de organização, use o seletor no topo. Convidar pessoas e alterar papéis: página «Equipe».</p>
        </Card>
      </div>
    </>
  );
}
