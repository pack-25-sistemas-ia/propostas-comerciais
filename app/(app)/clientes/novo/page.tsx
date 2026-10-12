import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/primitives';
import { ClientForm } from '@/components/proposals/forms';
import { requireContext } from '@/lib/auth/session';
import { WRITER_ROLES } from '@/lib/proposals/access';

export const metadata: Metadata = { title: 'Novo cliente' };

export default async function NewClientPage() {
  await requireContext(WRITER_ROLES);
  return (
    <>
      <PageHeader title="Novo cliente" />
      <Card><ClientForm /></Card>
    </>
  );
}
