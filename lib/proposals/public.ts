import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/env';
import { isTokenShape, hashToken } from './tokens';
import { parseSnapshot, type Snapshot } from './snapshot';

// Acesso público (cliente final) à proposta pelo link. Usa a chave pública (anon), SEM cookies nem sessão:
// o visitante só executa duas funções do banco (prop_public_view / prop_public_decide), identificadas pelo hash
// do token. Nenhuma tabela é acessível. Respostas de link inválido são idênticas (sem enumeração).

export type PublicState = 'open' | 'decided' | 'expired' | 'superseded' | 'cancelled' | 'unavailable';
export type PublicView = {
  state: PublicState;
  number: string | null;
  validUntil: string | null;
  snapshot: Snapshot | null;
  decision: { decision: 'accepted' | 'declined'; decidedAt: string } | null;
};

const UNAVAILABLE: PublicView = { state: 'unavailable', number: null, validUntil: null, snapshot: null, decision: null };

function anonClient() {
  const env = getPublicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function fetchPublicProposal(token: string, human: boolean): Promise<PublicView> {
  if (!isTokenShape(token)) return UNAVAILABLE;
  const { data, error } = await anonClient().rpc('prop_public_view', { p_token_hash: hashToken(token), p_human: human });
  if (error || !data || typeof data !== 'object') return UNAVAILABLE;
  const r = data as { state?: string; number?: string; valid_until?: string | null; snapshot?: unknown; decision?: { decision?: string; decided_at?: string } | null };
  const state = (['open', 'decided', 'expired', 'superseded', 'cancelled'] as const).find((s) => s === r.state);
  if (!state) return UNAVAILABLE;
  const snapshot = r.snapshot ? parseSnapshot(r.snapshot) : null;
  if ((state === 'open' || state === 'decided' || state === 'expired') && !snapshot) return UNAVAILABLE;
  const d = r.decision;
  return {
    state,
    number: r.number ?? null,
    validUntil: r.valid_until ?? null,
    snapshot,
    decision: d && (d.decision === 'accepted' || d.decision === 'declined') && d.decided_at ? { decision: d.decision, decidedAt: d.decided_at } : null,
  };
}

export type DecideError = 'invalid' | 'unavailable' | 'cancelled' | 'superseded' | 'already_decided' | 'expired' | 'failed';
export type DecideResult = { ok: true; decision: 'accepted' | 'declined' } | { ok: false; error: DecideError };

export async function submitPublicDecision(token: string, input: { decision: 'accepted' | 'declined'; name: string; email: string; comment: string | null }): Promise<DecideResult> {
  if (!isTokenShape(token)) return { ok: false, error: 'unavailable' };
  const { data, error } = await anonClient().rpc('prop_public_decide', {
    p_token_hash: hashToken(token), p_decision: input.decision, p_name: input.name, p_email: input.email, p_comment: input.comment,
  });
  if (error || !data || typeof data !== 'object') return { ok: false, error: 'failed' };
  const r = data as { ok?: boolean; decision?: string; error?: string };
  if (r.ok && (r.decision === 'accepted' || r.decision === 'declined')) return { ok: true, decision: r.decision };
  const known: DecideError[] = ['invalid', 'unavailable', 'cancelled', 'superseded', 'already_decided', 'expired'];
  return { ok: false, error: known.find((e) => e === r.error) ?? 'failed' };
}
