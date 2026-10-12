import type { Metadata } from 'next';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { ActionButton } from '@/components/app/form-kit';
import { DocumentView, docThemeHref } from '@/components/proposals/document-view';
import { TemplateForm } from '@/components/proposals/forms';
import { requireContext } from '@/lib/auth/session';
import { isCommercialAdmin } from '@/lib/proposals/access';
import { setDefaultTemplate } from '@/lib/proposals/actions';
import { loadSettings, loadTemplates } from '@/lib/proposals/data';
import { sampleSnapshot } from '@/lib/proposals/sample';

export const metadata: Metadata = { title: 'Modelos' };

const BASE_LABEL = { corporate: 'Corporativo', agency: 'Agência criativa', technical: 'Serviços técnicos' } as const;

export default async function TemplatesPage() {
  const ctx = await requireContext();
  const [templates, settings] = await Promise.all([loadTemplates(ctx), loadSettings(ctx)]);
  const admin = isCommercialAdmin(ctx.membership.role);
  const company = {
    name: ctx.membership.name, legal_name: settings.legal_name, document_number: settings.document_number, email: settings.email, phone: settings.phone, address: settings.address,
    footer_text: settings.footer_text, primary_color: settings.primary_color, secondary_color: settings.secondary_color, logo_data_url: settings.logo_data_url,
  };

  return (
    <>
      <PageHeader title="Modelos" description="Três aparências para os documentos. O conteúdo da proposta é independente do modelo: trocar de modelo não apaga nada. Cores e logotipo vêm das Configurações." />
      <link rel="stylesheet" href={docThemeHref(company.primary_color, company.secondary_color)} precedence="doc-theme" />
      <div className="space-y-6">
        {templates.map((t) => {
          async function makeDefault() {
            'use server';
            return setDefaultTemplate(t.id);
          }
          return (
            <Card key={t.id}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{t.name} {t.is_default ? <Badge tone="success">Padrão</Badge> : null}</h2>
                  <p className="text-sm text-muted">{BASE_LABEL[t.base]}{t.description ? ` — ${t.description}` : ''}</p>
                </div>
                {admin && !t.is_default ? <ActionButton label="Definir como padrão" action={makeDefault} /> : null}
              </div>
              <details className="mb-4">
                <summary className="cursor-pointer text-sm font-medium">Ver exemplo do modelo</summary>
                <div className="mt-3"><DocumentView snapshot={sampleSnapshot(t.base, t.name, company)} /></div>
              </details>
              {admin ? <TemplateForm template={t} /> : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
