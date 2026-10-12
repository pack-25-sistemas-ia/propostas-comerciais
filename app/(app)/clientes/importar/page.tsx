import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/primitives';
import { ImportClientsForm } from '@/components/proposals/forms';
import { requireContext } from '@/lib/auth/session';
import { WRITER_ROLES } from '@/lib/proposals/access';

export const metadata: Metadata = { title: 'Importar clientes' };

export default async function ImportClientsPage() {
  await requireContext(WRITER_ROLES);
  return (
    <>
      <PageHeader title="Importar clientes" description="Envie uma planilha CSV. Primeiro confira o relatório (nada é gravado); depois importe de verdade. Clientes com CPF/CNPJ já cadastrado são ignorados.">
        <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href="/export/clients-template">Baixar modelo</Link>
      </PageHeader>
      <Card><ImportClientsForm /></Card>
    </>
  );
}
