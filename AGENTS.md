# AGENTS — Gestão de Propostas Comerciais

Sistema 02 do Pack 25 Sistemas IA (propostas-comerciais). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS; toda mutação valida sessão, papel e entrada (Zod) no servidor.
- Nunca commitar segredos; service-role key só no servidor, jamais com prefixo NEXT_PUBLIC_.
- Dados pessoais mínimos; sem PII em logs; sem dados reais de cliente em seed.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db (Docker) · pnpm test:e2e (Supabase local + app) · node scripts/gen-pricing-sql.mjs (regera o SQL das fixtures de cálculo)

## Regras do sistema
- Cálculo e estados vivem no BANCO (`prop_compute`, funções `prop_*`, gatilhos); `lib/proposals/pricing.ts` é só o espelho da prévia. Alterou uma regra de cálculo: atualize `tests/fixtures/pricing-cases.json` (valores à mão), rode `gen-pricing-sql.mjs` e os dois conjuntos de testes.
- Revisão publicada é imutável; mudança = nova revisão. Nunca escreva em `status`, número ou `snapshot_json` fora das funções.
- Conteúdo de texto é JSON sanitizado (`content.ts`); nunca renderize HTML bruto.
- Rotas públicas só sob `/p/` (`lib/security/public-prefixes.ts`); só as duas funções `PUBLIC_ENDPOINT` são executáveis por `anon`.
- CSP estrita: sem estilo em linha; cores do documento por `/p/theme.css`; gráficos e editor só no navegador.
- PDF: não ponha `lineHeight` no `Page` (o react-pdf descarta o rodapé com `render`).
- Documentação: `docs/PLANO_IMPLEMENTACAO.md`, `DATABASE.md`, `ARCHITECTURE.md`, `METRICS.md`, `FEATURES.md`.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, fluxos críticos em Playwright,
mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
