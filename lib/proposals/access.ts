import type { OrgRole } from '@/lib/validation/org';

// Espelha as políticas do banco (que continuam sendo a barreira real). Serve para esconder o que o papel não pode usar.
export const canWriteProposals = (role: OrgRole) => role !== 'viewer';
export const isManager = (role: OrgRole) => role === 'owner' || role === 'admin' || role === 'manager';
export const isCommercialAdmin = (role: OrgRole) => role === 'owner' || role === 'admin';

export const WRITER_ROLES = ['owner', 'admin', 'manager', 'member'] as const;
export const MANAGER_ROLES = ['owner', 'admin', 'manager'] as const;
export const ADMIN_ROLES = ['owner', 'admin'] as const;

export function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
