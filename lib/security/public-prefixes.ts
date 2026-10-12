// Rotas públicas deste sistema: a página do cliente (link seguro da proposta). Cada uma valida o token
// e nunca usa sessão (ver app/p/[token]). Arquivo do sistema (.core-overrides).
export const PUBLIC_PREFIXES: readonly string[] = ['/p/'];
