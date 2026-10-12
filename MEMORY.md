# MEMORY — GESTÃO DE PROPOSTAS COMERCIAIS
Atualizado em: 2026-10-12 | Versão: 0.2.0 | Estado: VALIDADO (CI verde em 2026-10-12)

## Missão
Propostas profissionais: clientes, catálogo, construtor com cálculo no banco, versões imutáveis, PDF, link seguro de aceite/recusa e indicadores reais. Prompt de origem: «Sistema 02 v2.0».

## Stack e caminhos-chave
Next 16 + TS estrito + Tailwind 4 + Supabase. Core sincronizado (raiz). Sistema: `lib/proposals/*` (domínio, ações, dados, PDF), `components/proposals/*`, `app/(app)/{dashboard,propostas,clientes,catalogo,modelos,relatorios,metas,configuracoes,perfil}`, `app/p/[token]` (pública), `supabase/migrations/20270201*`, `supabase/tests/60–64`.
Comandos: `pnpm lint | typecheck | test | build | test:db | test:e2e`.

## Implementado e verificado (2026-10-12, local)
Tudo de `docs/FEATURES.md`. Unitários 115; banco (cálculo, RLS, fluxo, público, indicadores) passando, 14 mutações detectadas; E2E: fluxo, ciclo de vida, segurança, painel/relatórios/mobile; PDF lido de volta (pdf.js).

## Pendências e riscos
- CI do sistema 02 verde; instalação isolada validada (install, lint, tipos, 115 unit, build, test:db, 37 E2E).
- Envio de e-mail real: NÃO TESTADO (sem credenciais).
- Fontes padrão do PDF (sem alfabeto não latino).
- Risco LGPD: médio.

## Decisões relevantes
- Cálculo/estados no banco + espelho TS com as mesmas fixtures; snapshot imutável na publicação; um motor de PDF (react-pdf); conteúdo como JSON sanitizado; logotipo em data URL; link com hash; `PUBLIC_ENDPOINT` no Core para endpoints públicos; estrutura raiz do Core em vez de `src/`.

## Testes e deploy
- Último ciclo local: tudo verde (ver Implementado). Deploy: não configurado (responsabilidade de quem implanta).

## Próxima tarefa recomendada
1. Manter; novas funções entram com teste e documentação.
2. Sistema 03.

## Referências
docs/PLANO_IMPLEMENTACAO.md · FEATURES.md · METRICS.md · DATABASE.md · ARCHITECTURE.md · DEPLOYMENT.md · OPEN_SOURCE_AUDIT.md
