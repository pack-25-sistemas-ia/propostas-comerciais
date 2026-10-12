import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Card, PageHeader } from '@/components/ui/primitives';
import { ActionButton } from '@/components/app/form-kit';
import { CatalogForm } from '@/components/proposals/forms';
import { requireContext } from '@/lib/auth/session';
import { MANAGER_ROLES } from '@/lib/proposals/access';
import { duplicateCatalogItem, setCatalogActive } from '@/lib/proposals/actions';
import type { CatalogRow } from '@/lib/proposals/data';

export const metadata: Metadata = { title: 'Item do catálogo' };

export default async function CatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext(MANAGER_ROLES);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data } = await ctx.supabase.from('catalog_items').select('*').eq('id', id).eq('organization_id', ctx.membership.organization_id).maybeSingle();
  const item = data as CatalogRow | null;
  if (!item) notFound();

  async function toggle() {
    'use server';
    return setCatalogActive(id, !item!.active);
  }
  async function duplicate() {
    'use server';
    return duplicateCatalogItem(id);
  }

  return (
    <>
      <PageHeader title={item.name} description={item.active ? 'Item ativo.' : 'Item inativo: não aparece na seleção de novas propostas.'}>
        <div className="flex flex-wrap gap-2">
          <ActionButton label={item.active ? 'Desativar' : 'Reativar'} action={toggle} />
          <ActionButton label="Duplicar" action={duplicate} />
          <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" href="/catalogo">Voltar</Link>
        </div>
      </PageHeader>
      <Card><CatalogForm item={item} /></Card>
    </>
  );
}
