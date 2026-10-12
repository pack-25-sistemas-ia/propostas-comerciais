'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { actionContext, type Context } from '@/lib/auth/session';
import { fail, fieldErrorsFrom, messageForDbError, succeed, type ActionState } from '@/lib/actions/result';
import { getPublicEnv } from '@/lib/env';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';
import { sanitizeContent } from './content';
import { MAX_IMPORT_BYTES, parseClientsCsv } from './csv';
import { proposalEmailText, sendEmail } from './email';
import { formatDate } from './format';
import { submitPublicDecision } from './public';
import { generateShareToken } from './tokens';
import {
  LOGO_TYPES, MAX_LOGO_BYTES, catalogItemSchema, clientSchema, decisionSchema, draftSchema, goalSchema, proposalCreateSchema, settingsSchema, templateSchema,
} from './validation';

export type SaveResult = ActionState & { id?: string; url?: string; total_cents?: number };

const WRITERS = ['owner', 'admin', 'manager', 'member'] as const;
const MANAGERS = ['owner', 'admin', 'manager'] as const;
const ADMINS = ['owner', 'admin'] as const;
const idSchema = z.uuid();

/**
 * Mensagens escritas por nós no banco (funções prop_*) são seguras e úteis para o usuário; erros nativos do
 * Postgres (violação de restrição etc.) viram mensagem genérica, sem vazar nomes de tabela ou coluna.
 */
function dbMessage(error: { code?: string; message?: string }, duplicate?: string): string {
  if (error.code === '23505' && duplicate) return duplicate;
  if (error.code === '23503') return 'Este registro está em uso ou referencia algo inexistente.';
  const own = ['23514', '22023', 'P0002', '42501'];
  const msg = error.message ?? '';
  if (own.includes(error.code ?? '') && msg && msg.length <= 200 && !/violat|constraint|relation|column|violação|restrição/i.test(msg)) {
    return msg.charAt(0).toUpperCase() + msg.slice(1) + (msg.endsWith('.') ? '' : '.');
  }
  return messageForDbError(error);
}

async function withContext(roles: readonly ('owner' | 'admin' | 'manager' | 'member')[]): Promise<{ ctx: Context } | { error: ActionState }> {
  return actionContext(roles);
}

function bust(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

// ===================================================================== clientes
export async function saveClient(id: string | null, input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const dup = 'Já existe um cliente ativo com este CPF/CNPJ.';
  if (id === null) {
    const { data, error } = await ctx.supabase.from('clients').insert({ organization_id: ctx.membership.organization_id, ...parsed.data }).select('id').single();
    if (error) return fail(dbMessage(error, dup));
    bust('/clientes');
    return { ...succeed('Cliente cadastrado.'), id: (data as { id: string }).id };
  }
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('clients').update(parsed.data).eq('id', id).eq('organization_id', ctx.membership.organization_id).select('id');
  if (error) return fail(dbMessage(error, dup));
  if (!data?.length) return fail('Você não tem permissão para alterar este cliente.');
  bust('/clientes', `/clientes/${id}`);
  return { ...succeed('Cliente atualizado.'), id };
}

export async function archiveClient(id: string, archive: boolean): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('clients').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', id).eq('organization_id', ctx.membership.organization_id).select('id');
  if (error) return fail(dbMessage(error, 'Já existe um cliente ativo com este CPF/CNPJ; arquive ou edite o outro antes de restaurar.'));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/clientes', `/clientes/${id}`);
  return succeed(archive ? 'Cliente arquivado.' : 'Cliente restaurado.');
}

export type ImportReport = ActionState & { created?: number; duplicates?: number; invalid?: number; lines?: string[]; unknownHeaders?: string[]; preview?: boolean };

/** Importação de clientes por CSV. `apply=false` só valida (relatório sem gravar). */
export async function importClients(_prev: ImportReport, formData: FormData): Promise<ImportReport> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const file = formData.get('file');
  const apply = formData.get('dryRun') !== 'on'; // caixa "apenas validar" marcada = não grava
  if (!(file instanceof File) || file.size === 0) return fail('Selecione um arquivo CSV.');
  if (file.size > MAX_IMPORT_BYTES) return fail('Arquivo muito grande (máximo de 1 MB).');
  const parsedCsv = parseClientsCsv(await file.text());
  if (!parsedCsv.ok) return fail(parsedCsv.error);

  const org = ctx.membership.organization_id;
  const { data: existing } = await ctx.supabase.from('clients').select('document_number').eq('organization_id', org).is('archived_at', null).not('document_number', 'is', null);
  const taken = new Set(((existing ?? []) as Array<{ document_number: string }>).map((c) => c.document_number));
  const rows: z.output<typeof clientSchema>[] = [];
  const lines: string[] = [];
  let duplicates = 0;
  let invalid = 0;
  for (const r of parsedCsv.rows) {
    const v = r.values;
    const typeRaw = (v.type ?? '').toLowerCase();
    const candidate = {
      type: /pessoa|fisic|person|pf/.test(typeRaw) ? 'person' : 'company',
      name: v.name ?? '', legal_name: v.legal_name ?? '', document_number: v.document_number ?? '', email: v.email ?? '', phone: v.phone ?? '', address: v.address ?? '', notes: v.notes ?? '',
    };
    const res = clientSchema.safeParse(candidate);
    if (!res.success) {
      invalid += 1;
      if (lines.length < 50) lines.push(`Linha ${r.line}: ${res.error.issues[0]?.message ?? 'dados inválidos'}`);
      continue;
    }
    const doc = res.data.document_number;
    if (doc && taken.has(doc)) {
      duplicates += 1;
      if (lines.length < 50) lines.push(`Linha ${r.line}: já existe cliente com este CPF/CNPJ.`);
      continue;
    }
    if (doc) taken.add(doc);
    rows.push(res.data);
  }
  const base = { unknownHeaders: parsedCsv.unknownHeaders, lines, duplicates, invalid };
  if (!apply) return { ...succeed(`Validação concluída: ${rows.length} pronto(s) para importar, ${duplicates} duplicado(s), ${invalid} com erro. Nada foi gravado.`), ...base, created: rows.length, preview: true };
  if (rows.length === 0) return { ...fail('Nenhuma linha válida para importar.'), ...base, created: 0 };
  const payload = rows.map((r) => ({ organization_id: org, ...r }));
  const { error } = await ctx.supabase.from('clients').insert(payload);
  if (error) return { ...fail(dbMessage(error, 'O arquivo contém documento repetido.')), ...base, created: 0 };
  logEvent('info', 'clients_imported', { count: rows.length });
  bust('/clientes');
  return { ...succeed(`${rows.length} cliente(s) importado(s).`), ...base, created: rows.length };
}

// ===================================================================== catálogo
export async function saveCatalogItem(id: string | null, input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = catalogItemSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { default_price, ...rest } = parsed.data;
  const row = { ...rest, default_price_cents: default_price };
  const dup = 'Já existe um item com este código (SKU).';
  if (id === null) {
    const { data, error } = await ctx.supabase.from('catalog_items').insert({ organization_id: ctx.membership.organization_id, ...row }).select('id').single();
    if (error) return fail(dbMessage(error, dup));
    bust('/catalogo');
    return { ...succeed('Item cadastrado.'), id: (data as { id: string }).id };
  }
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('catalog_items').update(row).eq('id', id).eq('organization_id', ctx.membership.organization_id).select('id');
  if (error) return fail(dbMessage(error, dup));
  if (!data?.length) return fail('Você não tem permissão para alterar este item.');
  bust('/catalogo');
  return { ...succeed('Item atualizado. Propostas já publicadas não mudam.'), id };
}

export async function setCatalogActive(id: string, active: boolean): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('catalog_items').update({ active }).eq('id', id).eq('organization_id', ctx.membership.organization_id).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/catalogo');
  return succeed(active ? 'Item reativado.' : 'Item desativado.');
}

export async function duplicateCatalogItem(id: string): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data: src } = await ctx.supabase.from('catalog_items').select('type, name, description, unit, default_price_cents').eq('id', id).eq('organization_id', ctx.membership.organization_id).maybeSingle();
  if (!src) return fail('Item não encontrado.');
  const s = src as { type: string; name: string; description: string | null; unit: string; default_price_cents: number };
  const { data, error } = await ctx.supabase.from('catalog_items').insert({
    organization_id: ctx.membership.organization_id, type: s.type, name: `${s.name} (cópia)`.slice(0, 160), description: s.description, unit: s.unit, default_price_cents: s.default_price_cents, active: true,
  }).select('id').single();
  if (error) return fail(dbMessage(error));
  bust('/catalogo');
  return { ...succeed('Item duplicado (sem código SKU).'), id: (data as { id: string }).id };
}

// ===================================================================== propostas
export async function createProposal(input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = proposalCreateSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { data, error } = await ctx.supabase.rpc('prop_create_proposal', { p_client: parsed.data.client_id, p_title: parsed.data.title, p_template: parsed.data.template_id });
  if (error) return fail(dbMessage(error));
  bust('/propostas', '/dashboard');
  return { ...succeed('Proposta criada.'), id: String(data) };
}

/** Salva o rascunho. Os totais são calculados no BANCO; o que o navegador mostra é só uma prévia. */
export async function saveDraft(revisionId: string, input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(revisionId).success) return fail('Revisão inválida.');
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const d = parsed.data;
  const payload = {
    title: d.title,
    client_id: d.client_id,
    template_id: d.template_id,
    issue_date: d.issue_date,
    valid_until: d.valid_until,
    discount: d.discount,
    charges: d.charges,
    items: d.items.map((it) => ({ ...it, description: it.description ?? '' })),
    content_json: sanitizeContent(d.content),
  };
  const { data, error } = await ctx.supabase.rpc('prop_save_draft', { p_revision: revisionId, p_payload: payload });
  if (error) return fail(dbMessage(error));
  const total = (data as { total_cents?: number } | null)?.total_cents;
  return { ...succeed('Rascunho salvo.'), total_cents: typeof total === 'number' ? total : undefined };
}

export async function publishRevision(revisionId: string): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(revisionId).success) return fail('Revisão inválida.');
  const { data, error } = await ctx.supabase.rpc('prop_publish_revision', { p_revision: revisionId });
  if (error) return fail(dbMessage(error));
  bust('/propostas', '/dashboard');
  return { ...succeed('Proposta publicada. Esta versão não pode mais ser alterada.'), total_cents: (data as { total_cents?: number } | null)?.total_cents };
}

export async function createRevision(proposalId: string): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(proposalId).success) return fail('Proposta inválida.');
  const { data, error } = await ctx.supabase.rpc('prop_create_revision', { p_proposal: proposalId });
  if (error) return fail(dbMessage(error));
  bust('/propostas', `/propostas/${proposalId}`);
  return { ...succeed('Nova revisão criada a partir da publicada.'), id: String(data) };
}

export async function cancelProposal(proposalId: string, reason: string): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(proposalId).success) return fail('Proposta inválida.');
  const { error } = await ctx.supabase.rpc('prop_cancel', { p_proposal: proposalId, p_reason: reason.slice(0, 300) });
  if (error) return fail(dbMessage(error));
  bust('/propostas', `/propostas/${proposalId}`, '/dashboard');
  return succeed('Proposta cancelada. Os links foram revogados.');
}

export async function duplicateProposal(proposalId: string): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(proposalId).success) return fail('Proposta inválida.');
  const { data, error } = await ctx.supabase.rpc('prop_duplicate', { p_proposal: proposalId, p_client: null });
  if (error) return fail(dbMessage(error));
  bust('/propostas');
  return { ...succeed('Proposta duplicada como rascunho.'), id: String(data) };
}

export async function archiveProposal(proposalId: string, archive: boolean): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(proposalId).success) return fail('Proposta inválida.');
  const { data, error } = await ctx.supabase.from('proposals').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', proposalId).eq('organization_id', ctx.membership.organization_id).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/propostas', `/propostas/${proposalId}`, '/dashboard');
  return succeed(archive ? 'Proposta arquivada.' : 'Proposta restaurada.');
}

// ===================================================================== compartilhamento
function appUrl(path: string): string {
  return `${getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}${path}`;
}

/** Cria o link seguro. O token aparece UMA vez (no banco fica só o hash): copie e envie. */
export async function createShareLink(proposalId: string, days: number): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(proposalId).success) return fail('Proposta inválida.');
  if (!Number.isInteger(days) || days < 1 || days > 365) return fail('Validade do link: de 1 a 365 dias.');
  const limit = rateLimit(`share:${ctx.user.id}`, { limit: 30, windowMs: 10 * 60_000 });
  if (!limit.allowed) return fail('Muitos links criados em pouco tempo. Aguarde alguns minutos.');
  const { token, hash } = generateShareToken();
  const { error } = await ctx.supabase.rpc('prop_create_share_link', { p_proposal: proposalId, p_token_hash: hash, p_expires_at: new Date(Date.now() + days * 86_400_000).toISOString() });
  if (error) return fail(dbMessage(error));
  bust(`/propostas/${proposalId}`);
  return { ...succeed('Link criado. Copie agora: por segurança ele não é exibido de novo.'), url: appUrl(`/p/${token}`) };
}

export async function revokeShareLink(linkId: string, proposalId: string): Promise<ActionState> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(linkId).success) return fail('Link inválido.');
  const { error } = await ctx.supabase.rpc('prop_revoke_share_link', { p_link: linkId });
  if (error) return fail(dbMessage(error));
  bust(`/propostas/${proposalId}`);
  return succeed('Link revogado.');
}

const emailSchema = z.object({ proposal_id: z.uuid(), to: z.string().trim().toLowerCase().max(254).pipe(z.email('E-mail inválido.')) });

/** Cria um link novo e tenta enviar por e-mail. Sem provedor configurado, informa e devolve o link para compartilhar à mão. */
export async function sendProposalEmail(input: unknown): Promise<SaveResult> {
  const auth = await withContext(WRITERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique o e-mail.', fieldErrorsFrom(parsed.error));
  const limit = rateLimit(`email:${ctx.user.id}`, { limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return fail('Muitos envios em pouco tempo. Aguarde.');

  const { data: prop } = await ctx.supabase.from('proposals').select('id, title, proposal_number, status, published_revision_id, client_id').eq('id', parsed.data.proposal_id).eq('organization_id', ctx.membership.organization_id).maybeSingle();
  const p = prop as { id: string; title: string; proposal_number: string; status: string; published_revision_id: string | null; client_id: string } | null;
  if (!p || !p.published_revision_id || !['sent', 'viewed'].includes(p.status)) return fail('Publique a proposta antes de enviar.');
  const [{ data: rev }, { data: client }] = await Promise.all([
    ctx.supabase.from('proposal_revisions').select('valid_until').eq('id', p.published_revision_id).maybeSingle(),
    ctx.supabase.from('clients').select('name').eq('id', p.client_id).maybeSingle(),
  ]);
  const validUntil = (rev as { valid_until: string | null } | null)?.valid_until ?? null;

  const { token, hash } = generateShareToken();
  const { error } = await ctx.supabase.rpc('prop_create_share_link', { p_proposal: p.id, p_token_hash: hash, p_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  if (error) return fail(dbMessage(error));
  const url = appUrl(`/p/${token}`);

  const result = await sendEmail({
    to: parsed.data.to,
    subject: `Proposta ${p.proposal_number} — ${p.title}`.slice(0, 200),
    text: proposalEmailText({ company: ctx.membership.name, client: (client as { name: string } | null)?.name ?? 'cliente', title: p.title, number: p.proposal_number, url, validUntil: validUntil ? formatDate(validUntil) : null }),
  });
  await ctx.supabase.from('proposal_email_deliveries').insert({
    organization_id: ctx.membership.organization_id, proposal_id: p.id, revision_id: p.published_revision_id, recipient_email: parsed.data.to,
    delivery_status: result.status, provider_reference: result.reference ?? null, error_message: result.error ?? null,
  });
  bust(`/propostas/${p.id}`);
  if (result.status === 'sent') return { ...succeed('E-mail enviado ao provedor. O link também está abaixo.'), url };
  if (result.status === 'failed') return { ...fail(`${result.error ?? 'Falha no envio.'} Compartilhe o link manualmente.`), url };
  return { ...succeed('Envio de e-mail não configurado neste ambiente: nenhum e-mail foi enviado. Copie o link e compartilhe manualmente.'), url };
}

// ===================================================================== decisão do cliente (pública)
export type DecisionResult = { ok: true; decision: 'accepted' | 'declined' } | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || h.get('x-real-ip') || 'desconhecido';
}

const DECIDE_MESSAGES: Record<string, string> = {
  invalid: 'Verifique o nome, o e-mail e o comentário.',
  unavailable: 'Este link não está mais disponível.',
  cancelled: 'Esta proposta foi cancelada.',
  superseded: 'Existe uma versão mais recente desta proposta. Peça o novo link a quem enviou.',
  already_decided: 'Esta proposta já recebeu uma resposta.',
  expired: 'Esta proposta venceu e não pode mais ser aceita.',
  failed: 'Não foi possível registrar sua resposta. Tente novamente.',
};

/** Aceite ou recusa pelo cliente, sem login. Limite de taxa por visitante e por link; o banco serializa decisões concorrentes. */
export async function decideProposal(token: string, input: unknown): Promise<DecisionResult> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Verifique os campos.', fieldErrors: fieldErrorsFrom(parsed.error) };
  const ip = await clientIp();
  const limit = rateLimit(`decide:${ip}:${token.slice(0, 8)}`, { limit: 8, windowMs: 10 * 60_000 });
  if (!limit.allowed) return { ok: false, message: 'Muitas tentativas. Aguarde alguns minutos.' };
  const r = await submitPublicDecision(token, { decision: parsed.data.decision, name: parsed.data.name, email: parsed.data.email, comment: parsed.data.comment });
  if (r.ok) return r;
  return { ok: false, message: DECIDE_MESSAGES[r.error] ?? DECIDE_MESSAGES.failed! };
}

// ===================================================================== configurações, modelos, metas
export async function saveSettings(input: unknown): Promise<SaveResult> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const d = parsed.data;
  const { data, error } = await ctx.supabase.from('proposal_settings').update({
    ...d, max_discount_member_pct: Number(d.max_discount_member_pct), max_discount_manager_pct: Number(d.max_discount_manager_pct),
  }).eq('organization_id', ctx.membership.organization_id).select('organization_id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para alterar as configurações.');
  bust('/configuracoes', '/propostas');
  return succeed('Configurações salvas. Propostas já publicadas não mudam.');
}

function logoDataUrl(bytes: Uint8Array): string | null {
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) return null;
  return `data:image/${isPng ? LOGO_TYPES['image/png'] : LOGO_TYPES['image/jpeg']};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Logotipo dos documentos: PNG ou JPEG até 300 KB, conferido pelos bytes (não pela extensão). */
export async function uploadLogo(formData: FormData): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return fail('Selecione uma imagem PNG ou JPEG.');
  if (file.size > MAX_LOGO_BYTES) return fail('Imagem muito grande (máximo de 300 KB).');
  const url = logoDataUrl(new Uint8Array(await file.arrayBuffer()));
  if (!url) return fail('Formato não permitido: use PNG ou JPEG.');
  const { data, error } = await ctx.supabase.from('proposal_settings').update({ logo_data_url: url }).eq('organization_id', ctx.membership.organization_id).select('organization_id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para alterar o logotipo.');
  bust('/configuracoes');
  return succeed('Logotipo atualizado. Vale para as próximas publicações.');
}

export async function removeLogo(): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const { error } = await ctx.supabase.from('proposal_settings').update({ logo_data_url: null }).eq('organization_id', ctx.membership.organization_id);
  if (error) return fail(dbMessage(error));
  bust('/configuracoes');
  return succeed('Logotipo removido.');
}

export async function saveTemplate(id: string, input: unknown): Promise<SaveResult> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const { data, error } = await ctx.supabase.from('proposal_templates').update(parsed.data).eq('id', id).eq('organization_id', ctx.membership.organization_id).select('id');
  if (error) return fail(dbMessage(error, 'Já existe um modelo com este nome.'));
  if (!data?.length) return fail('Você não tem permissão para alterar este modelo.');
  bust('/modelos');
  return succeed('Modelo atualizado.');
}

export async function setDefaultTemplate(id: string): Promise<ActionState> {
  const auth = await withContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('proposal_templates').update({ is_default: true }).eq('id', id).eq('organization_id', ctx.membership.organization_id).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/modelos');
  return succeed('Modelo padrão atualizado.');
}

export async function saveGoal(input: unknown): Promise<SaveResult> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));
  const d = parsed.data;
  const { error } = await ctx.supabase.from('commercial_goals').insert({
    organization_id: ctx.membership.organization_id, user_id: d.user_id, period_start: d.period_start, period_end: d.period_end, target_value_cents: d.target,
  });
  if (error) return fail(dbMessage(error));
  bust('/metas', '/dashboard');
  return succeed('Meta criada.');
}

export async function deleteGoal(id: string): Promise<ActionState> {
  const auth = await withContext(MANAGERS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  if (!idSchema.safeParse(id).success) return fail('Registro inválido.');
  const { data, error } = await ctx.supabase.from('commercial_goals').delete().eq('id', id).eq('organization_id', ctx.membership.organization_id).select('id');
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail('Você não tem permissão para esta ação.');
  bust('/metas', '/dashboard');
  return succeed('Meta removida.');
}
