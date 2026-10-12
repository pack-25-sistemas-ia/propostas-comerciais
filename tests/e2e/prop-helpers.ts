import type { Browser, BrowserContext, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { apiAal2Token, apiLogin, apiSignUp, onboardAndEnrollMfa, rest, uiLogin, uniqueEmail } from './helpers';

export type Owner = { ctx: BrowserContext; page: Page; email: string; userId: string; secret: string; orgId: string; token: string };

export const suffix = () => randomBytes(3).toString('hex');

/** Cria um proprietário com organização e MFA ativo, mais um token AAL2 para preparar dados via API. */
export async function setupOwner(browser: Browser, tag: string): Promise<Owner> {
  const email = uniqueEmail(tag);
  const { id: userId } = await apiSignUp(email);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await uiLogin(page, email);
  const secret = await onboardAndEnrollMfa(page, `Empresa ${tag} ${suffix()}`);
  const orgId = (await ctx.cookies()).find((c) => c.name === 'pack25_org')!.value;
  const token = await apiAal2Token(await apiLogin(email), secret);
  return { ctx, page, email, userId, secret, orgId, token };
}

export async function restJson<T = unknown>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await rest(token, path, init);
  if (!res.ok) throw new Error(`REST ${path} falhou: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Registra violações de Content-Security-Policy vistas no console do navegador. */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

export async function addMember(owner: Owner, userId: string, role: 'member' | 'manager' | 'viewer') {
  await restJson(owner.token, 'organization_members', { method: 'POST', body: JSON.stringify({ organization_id: owner.orgId, user_id: userId, role }) });
}

/** Data (YYYY-MM-DD) daqui a `days` dias, no horário de Brasília. */
export function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

// ---------------------------------------------------------------- preparação de cenários por API (rápida; a interface é testada nos fluxos)
import { createHash } from 'node:crypto';
import { BASE_URL } from './helpers';

export async function rpc<T = unknown>(token: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await rest(token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`rpc ${fn} falhou: ${res.status} ${await res.text()}`);
  const body = await res.text();
  return (body ? JSON.parse(body) : null) as T; // funções que não devolvem nada respondem sem corpo
}

export async function seedClient(owner: Owner, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const rows = await restJson<Array<{ id: string }>>(owner.token, 'clients', { method: 'POST', body: JSON.stringify({ organization_id: owner.orgId, name, ...extra }) });
  return rows[0]!.id;
}

/** Token aleatório + hash, como a aplicação gera (43 caracteres base64url; SHA-256 em hexadecimal). */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
}

export type Published = { proposalId: string; revisionId: string; token: string; url: string };

/** Cria, preenche, publica e compartilha uma proposta por API (como o dono). Total = quantidade x preço (sem descontos). */
export async function seedPublished(owner: Owner, a: { clientId: string; title: string; priceCents?: number; quantity?: string; validDays?: number; share?: boolean }): Promise<Published> {
  const proposalId = await rpc<string>(owner.token, 'prop_create_proposal', { p_client: a.clientId, p_title: a.title });
  const rows = await restJson<Array<{ current_revision_id: string }>>(owner.token, `proposals?id=eq.${proposalId}&select=current_revision_id`);
  const revisionId = rows[0]!.current_revision_id;
  await rpc(owner.token, 'prop_save_draft', {
    p_revision: revisionId,
    p_payload: { valid_until: inDays(a.validDays ?? 20), items: [{ item_type: 'service', name: 'Serviço de teste', unit: 'un', quantity: a.quantity ?? '1', unit_price_cents: a.priceCents ?? 100000, discount_kind: 'none', discount_value: '0' }] },
  });
  await rpc(owner.token, 'prop_publish_revision', { p_revision: revisionId });
  const { token, hash } = newToken();
  if (a.share !== false) await rpc(owner.token, 'prop_create_share_link', { p_proposal: proposalId, p_token_hash: hash, p_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  return { proposalId, revisionId, token, url: `${BASE_URL}/p/${token}` };
}

export async function decisionCount(owner: Owner, proposalId: string): Promise<number> {
  const rows = await restJson<unknown[]>(owner.token, `proposal_decisions?proposal_id=eq.${proposalId}&select=id`);
  return rows.length;
}
