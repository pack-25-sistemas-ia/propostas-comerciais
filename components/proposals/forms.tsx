'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useRef, useState } from 'react';
import type { z } from 'zod';
import { ActionButton, CheckField, FormShell, SelectField, TextAreaField, TextField, useActionForm, type Opt } from '@/components/app/form-kit';
import { Alert, Button, Field } from '@/components/ui/primitives';
import {
  archiveClient, importClients, removeLogo, saveCatalogItem, saveClient, saveGoal, saveSettings, saveTemplate, createProposal, uploadLogo, type ImportReport,
} from '@/lib/proposals/actions';
import { MAX_IMPORT_BYTES } from '@/lib/proposals/csv';
import { centsToInput } from '@/lib/proposals/format';
import {
  CLIENT_TYPE_LABELS, CLIENT_TYPES, catalogItemSchema, clientSchema, goalSchema, proposalCreateSchema, settingsSchema, templateSchema,
} from '@/lib/proposals/validation';
import type { CatalogRow, ClientRow, SettingsRow, TemplateRow } from '@/lib/proposals/data';

const s = (v: string | null | undefined) => v ?? '';
const typeOpts: Opt[] = CLIENT_TYPES.map((t) => ({ value: t, label: CLIENT_TYPE_LABELS[t] }));

// ======================================================================= clientes
export function ClientForm({ client }: { client?: ClientRow }) {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm<z.input<typeof clientSchema>, z.output<typeof clientSchema>>({
    schema: clientSchema,
    defaultValues: {
      type: client?.type ?? 'company', name: s(client?.name), legal_name: s(client?.legal_name), document_number: s(client?.document_number), email: s(client?.email),
      phone: s(client?.phone), address: s(client?.address), notes: s(client?.notes),
    },
    action: (input) => saveClient(client?.id ?? null, input),
    onSuccess: (r) => { if (!client && r.id) router.push(`/clientes/${r.id}`); },
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel={client ? 'Salvar cliente' : 'Cadastrar cliente'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="name" label="Nome" />
        <SelectField form={form} name="type" label="Tipo" options={typeOpts} />
        <TextField form={form} name="legal_name" label="Razão social" />
        <TextField form={form} name="document_number" label="CPF ou CNPJ" inputMode="numeric" hint="Opcional. Validado pelos dígitos verificadores." />
        <TextField form={form} name="email" label="E-mail" type="email" />
        <TextField form={form} name="phone" label="Telefone" type="tel" />
      </div>
      <TextField form={form} name="address" label="Endereço" />
      <TextAreaField form={form} name="notes" label="Observações" maxLength={4000} />
    </FormShell>
  );
}

export function ArchiveClientButton({ id, archived }: { id: string; archived: boolean }) {
  return (
    <ActionButton
      label={archived ? 'Restaurar' : 'Arquivar'}
      confirm={archived ? undefined : 'Arquivar este cliente? Ele sai das listas e dos novos cadastros, mas as propostas continuam.'}
      action={() => archiveClient(id, !archived)}
    />
  );
}

export function ImportClientsForm() {
  const [state, action, pending] = useActionState(importClients, {} as ImportReport);
  // o servidor (Next) recusa corpos acima de ~1 MB antes da nossa validação: avisa já no navegador
  const [tooBig, setTooBig] = useState(false);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <Field label="Arquivo CSV" name="file" hint="Até 1 MB e 2.000 linhas. Separador ; ou , e codificação UTF-8. Colunas: nome, razão social, CPF/CNPJ, e-mail, telefone, endereço, tipo, observações.">
          <input id="file" name="file" type="file" accept=".csv,text/csv" required onChange={(e) => setTooBig((e.target.files?.[0]?.size ?? 0) > MAX_IMPORT_BYTES)} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm" />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="dryRun" defaultChecked className="mt-1 size-4" />
          <span><strong>Apenas validar</strong> (não grava nada). Desmarque para importar de verdade depois de conferir o relatório.</span>
        </label>
        <Button type="submit" disabled={pending || tooBig} aria-busy={pending}>{pending ? 'Processando…' : 'Enviar'}</Button>
      </form>
      {tooBig ? <Alert tone="error">Arquivo muito grande (máximo de 1 MB).</Alert> : null}
      {state.message ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
      {state.created !== undefined ? (
        <section aria-label="Relatório da importação" className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          <dl className="grid grid-cols-3 gap-3">
            <div><dt className="text-muted">{state.preview ? 'Prontos' : 'Importados'}</dt><dd className="text-lg font-semibold tabular-nums">{state.created}</dd></div>
            <div><dt className="text-muted">Duplicados</dt><dd className="text-lg font-semibold tabular-nums">{state.duplicates ?? 0}</dd></div>
            <div><dt className="text-muted">Com erro</dt><dd className="text-lg font-semibold tabular-nums">{state.invalid ?? 0}</dd></div>
          </dl>
          {state.unknownHeaders?.length ? <p className="text-muted">Colunas ignoradas: {state.unknownHeaders.join(', ')}.</p> : null}
          {state.lines?.length ? <ul className="max-h-56 space-y-1 overflow-auto">{state.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
        </section>
      ) : null}
    </div>
  );
}

// ======================================================================= catálogo
export function CatalogForm({ item }: { item?: CatalogRow }) {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm<z.input<typeof catalogItemSchema>, z.output<typeof catalogItemSchema>>({
    schema: catalogItemSchema,
    defaultValues: {
      type: item?.type ?? 'service', name: s(item?.name), description: s(item?.description), sku: s(item?.sku), unit: item?.unit ?? 'un',
      default_price: centsToInput(item?.default_price_cents ?? 0), active: item?.active ?? true,
    },
    action: (input) => saveCatalogItem(item?.id ?? null, input),
    resetOnSuccess: !item,
    onSuccess: (r) => { if (!item && r.id) router.refresh(); },
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel={item ? 'Salvar item' : 'Cadastrar item'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="name" label="Nome" />
        <SelectField form={form} name="type" label="Tipo" options={[{ value: 'service', label: 'Serviço' }, { value: 'product', label: 'Produto' }]} />
        <TextField form={form} name="sku" label="Código (opcional)" maxLength={40} />
        <TextField form={form} name="unit" label="Unidade" hint="Ex.: un, h, mês, m²" maxLength={20} />
        <TextField form={form} name="default_price" label="Preço padrão (R$)" inputMode="decimal" placeholder="1.500,00" />
        <div className="self-end pb-2"><CheckField form={form} name="active" label="Item ativo" /></div>
      </div>
      <TextAreaField form={form} name="description" label="Descrição" maxLength={2000} />
    </FormShell>
  );
}

// ======================================================================= nova proposta
export function ProposalCreateForm({ clients, templates, defaultTemplate, defaultClient }: { clients: Opt[]; templates: Opt[]; defaultTemplate: string; defaultClient?: string }) {
  const router = useRouter();
  const { form, state, pending, submit } = useActionForm<z.input<typeof proposalCreateSchema>, z.output<typeof proposalCreateSchema>>({
    schema: proposalCreateSchema,
    defaultValues: { client_id: defaultClient ?? '', title: '', template_id: defaultTemplate },
    action: (input) => createProposal(input),
    onSuccess: (r) => { if (r.id) router.push(`/propostas/${r.id}/editar`); },
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Criar proposta e abrir o editor">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField form={form} name="client_id" label="Cliente" options={clients} empty="Selecione o cliente" />
        <SelectField form={form} name="template_id" label="Modelo visual" options={templates} hint="Dá para trocar depois sem perder nada." />
      </div>
      <TextField form={form} name="title" label="Título da proposta" placeholder="Ex.: Implantação do sistema de gestão" />
    </FormShell>
  );
}

// ======================================================================= configurações
export function SettingsForm({ settings }: { settings: SettingsRow }) {
  const { form, state, pending, submit } = useActionForm<z.input<typeof settingsSchema>, z.output<typeof settingsSchema>>({
    schema: settingsSchema,
    defaultValues: {
      legal_name: s(settings.legal_name), document_number: s(settings.document_number), email: s(settings.email), phone: s(settings.phone), address: s(settings.address),
      footer_text: s(settings.footer_text), number_prefix: settings.number_prefix, default_validity_days: String(settings.default_validity_days), default_terms: s(settings.default_terms),
      primary_color: settings.primary_color, secondary_color: settings.secondary_color,
      max_discount_member_pct: String(settings.max_discount_member_pct).replace('.', ','), max_discount_manager_pct: String(settings.max_discount_manager_pct).replace('.', ','),
      alert_expiring_days: String(settings.alert_expiring_days), alert_no_reply_days: String(settings.alert_no_reply_days), alert_recent_accept_days: String(settings.alert_recent_accept_days),
    },
    action: (input) => saveSettings(input),
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Salvar configurações">
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Dados da empresa nos documentos</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="legal_name" label="Razão social" />
          <TextField form={form} name="document_number" label="CNPJ ou CPF" inputMode="numeric" />
          <TextField form={form} name="email" label="E-mail de contato" type="email" />
          <TextField form={form} name="phone" label="Telefone" type="tel" />
        </div>
        <TextField form={form} name="address" label="Endereço" />
        <TextAreaField form={form} name="footer_text" label="Rodapé dos documentos" maxLength={400} />
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Identidade visual</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="primary_color" label="Cor principal" placeholder="#162A43" maxLength={7} hint="Formato #RRGGBB." />
          <TextField form={form} name="secondary_color" label="Cor secundária" placeholder="#22D3EE" maxLength={7} />
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Regras comerciais</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="number_prefix" label="Prefixo da numeração" hint="Ex.: P- gera P-00001. Vale para as próximas propostas." maxLength={10} />
          <TextField form={form} name="default_validity_days" label="Validade padrão (dias)" inputMode="numeric" />
          <TextField form={form} name="max_discount_member_pct" label="Desconto máximo do vendedor (%)" inputMode="decimal" hint="Sobre o valor bruto. Acima disso a publicação é bloqueada." />
          <TextField form={form} name="max_discount_manager_pct" label="Desconto máximo do gestor (%)" inputMode="decimal" hint="Administradores não têm limite." />
        </div>
        <TextAreaField form={form} name="default_terms" label="Condições comerciais padrão" maxLength={4000} />
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Alertas</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField form={form} name="alert_expiring_days" label="Avisar vencimento (dias antes)" inputMode="numeric" />
          <TextField form={form} name="alert_no_reply_days" label="Sem retorno após (dias)" inputMode="numeric" />
          <TextField form={form} name="alert_recent_accept_days" label="Aceites recentes (dias)" inputMode="numeric" />
        </div>
      </fieldset>
    </FormShell>
  );
}

export function LogoForm({ logo }: { logo: string | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (_p: { ok?: boolean; message?: string }, fd: FormData) => {
    const r = await uploadLogo(fd);
    if (r.ok) { formRef.current?.reset(); router.refresh(); }
    return r;
  }, {} as { ok?: boolean; message?: string });
  return (
    <div className="space-y-3">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="Logotipo atual" className="h-16 max-w-56 rounded border border-border bg-white object-contain p-1" />
      ) : <p className="text-sm text-muted">Nenhum logotipo enviado: os documentos mostram só o nome da empresa.</p>}
      <form ref={formRef} action={action} className="space-y-3">
        <Field label="Enviar logotipo" name="logo" hint="PNG ou JPEG, até 300 KB. Vale para as próximas publicações.">
          <input id="logo" name="logo" type="file" accept="image/png,image/jpeg" required className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm" />
        </Field>
        <div className="flex flex-wrap items-start gap-2">
          <Button type="submit" disabled={pending}>{pending ? 'Enviando…' : 'Enviar logotipo'}</Button>
          {logo ? <ActionButton label="Remover logotipo" confirm="Remover o logotipo?" action={removeLogo} /> : null}
        </div>
      </form>
      {state.message ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
    </div>
  );
}

export function TemplateForm({ template }: { template: TemplateRow }) {
  const { form, state, pending, submit } = useActionForm<z.input<typeof templateSchema>, z.output<typeof templateSchema>>({
    schema: templateSchema,
    defaultValues: { name: template.name, description: s(template.description) },
    action: (input) => saveTemplate(template.id, input),
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Salvar modelo">
      <TextField form={form} name="name" label="Nome do modelo" />
      <TextAreaField form={form} name="description" label="Descrição" maxLength={300} />
    </FormShell>
  );
}

// ======================================================================= metas
export function GoalForm({ people }: { people: Opt[] }) {
  const { form, state, pending, submit } = useActionForm<z.input<typeof goalSchema>, z.output<typeof goalSchema>>({
    schema: goalSchema,
    defaultValues: { user_id: '', period_start: '', period_end: '', target: '' },
    action: (input) => saveGoal(input),
    resetOnSuccess: true,
  });
  return (
    <FormShell onSubmit={submit} pending={pending} state={state} submitLabel="Criar meta">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField form={form} name="user_id" label="Vendedor" options={people} empty="Selecione" />
        <TextField form={form} name="target" label="Meta de valor aceito (R$)" inputMode="decimal" placeholder="50.000,00" />
        <TextField form={form} name="period_start" label="Início" type="date" />
        <TextField form={form} name="period_end" label="Fim" type="date" />
      </div>
    </FormShell>
  );
}
