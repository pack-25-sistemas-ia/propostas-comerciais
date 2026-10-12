import type { Metadata } from 'next';
import { Alert, Card, PageHeader } from '@/components/ui/primitives';
import { LogoForm, SettingsForm } from '@/components/proposals/forms';
import { requireContext } from '@/lib/auth/session';
import { ADMIN_ROLES } from '@/lib/proposals/access';
import { loadSettings } from '@/lib/proposals/data';
import { emailProvider } from '@/lib/proposals/email';

export const metadata: Metadata = { title: 'Configurações comerciais' };

export default async function CommercialSettingsPage() {
  const ctx = await requireContext(ADMIN_ROLES);
  const settings = await loadSettings(ctx);
  const emailOn = emailProvider() !== null;

  return (
    <>
      <PageHeader title="Configurações comerciais" description="Dados da empresa nos documentos, identidade visual, regras de desconto e alertas. Mudanças valem para as próximas publicações: propostas já publicadas nunca mudam." />
      <div className="space-y-6">
        <Card title="Logotipo dos documentos"><LogoForm logo={settings.logo_data_url} /></Card>
        <Card title="Empresa, regras e alertas"><SettingsForm settings={settings} /></Card>
        <Card title="Envio de e-mail" description="Opcional. O fluxo principal (criar, publicar, compartilhar o link, aceite) funciona sem e-mail.">
          <Alert tone={emailOn ? 'success' : 'info'}>
            {emailOn
              ? 'Envio de e-mail configurado neste ambiente (provedor Resend).'
              : 'Envio de e-mail NÃO configurado neste ambiente: ao «enviar», o sistema só mostra o link para você compartilhar. Para ativar, defina EMAIL_PROVIDER, RESEND_API_KEY e EMAIL_FROM nas variáveis de ambiente (veja docs/DEPLOYMENT.md).'}
          </Alert>
        </Card>
      </div>
    </>
  );
}
