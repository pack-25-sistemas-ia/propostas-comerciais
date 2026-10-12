// Configuração da Gestão de Propostas Comerciais. Para personalizar para um cliente:
//  1. troque `name`;  2. substitua public/brand/logo.svg;  3. ajuste a navegação em `primaryNav`.
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
import type { OrgRole } from '@/lib/validation/org';

export type NavItem = { href: string; label: string; roles?: readonly OrgRole[] };

export const systemConfig: { name: string; logo: string; primaryNav: NavItem[] } = {
  name: 'Gestão de Propostas',
  logo: '/brand/logo.svg',
  primaryNav: [
    { href: '/dashboard', label: 'Painel' },
    { href: '/propostas', label: 'Propostas' },
    { href: '/clientes', label: 'Clientes' },
    { href: '/catalogo', label: 'Catálogo' },
    { href: '/modelos', label: 'Modelos' },
    { href: '/relatorios', label: 'Relatórios' },
    { href: '/metas', label: 'Metas' },
    { href: '/configuracoes', label: 'Configurações comerciais', roles: ['owner', 'admin'] },
  ],
};
