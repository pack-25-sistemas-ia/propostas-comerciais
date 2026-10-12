# DEPLOYMENT — Gestão de Propostas Comerciais

Tudo é seu: seu projeto Supabase, seu repositório, sua hospedagem. Nada é enviado ao autor do Pack.

## Pré-requisitos
Node 22+, pnpm, Docker (só para o Supabase local), conta Supabase (região **São Paulo** para dados pessoais) e hospedagem Node (ex.: Vercel).

## Variáveis (`.env.local`, nunca no git)
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app (usada nos links das propostas e e-mails) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable/anon (segura no navegador, limitada pelo RLS) |
| `EMAIL_PROVIDER` (opcional) | `resend` para ativar o envio por e-mail |
| `RESEND_API_KEY`, `EMAIL_FROM` (opcionais) | credenciais e remetente do provedor |

O app **não usa** `service_role`. Não a coloque em variável alguma. Sem as variáveis de e-mail, o sistema funciona e avisa que nada foi enviado: copie o link e compartilhe.

## Banco
1. Local: `supabase start` e `supabase db reset` (migrações + `seed.sql` com dados fictícios).
2. Produção: `supabase link --project-ref <ref>` e `supabase db push`. **Não** aplique `seed.sql` em produção (cria usuários de demonstração).
3. No Supabase: ative confirmação de e-mail, senha mínima de 12, TOTP, **SMTP próprio** e cadastre a URL do app em Redirect URLs. Modelos em `supabase/templates`.
4. Teste de banco: `pnpm test:db` (Docker).

## Aplicação
`pnpm install --frozen-lockfile` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm start`.
E2E: `pnpm test:e2e` (Supabase local com Mailpit e app rodando; veja `playwright.config.ts`).
**Windows:** use um caminho curto para a pasta (caminho muito longo quebra o Vitest/Vite).

## Dados de demonstração
Senha local única `DemoLocal#2026`: `dono@`, `gerente@`, `vendedor1@`, `vendedor2@`, `leitor@` `demo.exemplo`. O proprietário cadastra a verificação em duas etapas no primeiro acesso. Para uma implantação real, remova a organização «Empresa Demonstração».

## Primeiro uso real
Crie sua conta e a organização → Configurações (razão social, CNPJ, logotipo, cores, prefixo, validade, limites de desconto) → Clientes e Catálogo → Propostas. Adicionar pessoas à equipe: página «Equipe».

## Backup, restauração e rollback
- Ative backups automáticos no Supabase e **teste a restauração** antes de usar dados reais.
- Rollback de código: reimplante a tag anterior. Migrações são só para frente: para desfazer uma, escreva uma migração nova.
- Revisões publicadas são imutáveis por desenho: não há «editar a publicada»; crie uma nova revisão.
