# ARCHITECTURE — Gestão de Propostas Comerciais

Next.js 16 (App Router, `proxy.ts` com CSP por requisição) + TypeScript estrito + Tailwind 4 + Supabase (Auth, Postgres, RLS). Sem `service_role`: todo acesso do app usa a sessão do usuário (RLS) ou a chave pública para as duas funções do link público.

## Camadas (e onde estão)
| Camada | Responsabilidade | Onde |
|---|---|---|
| Interface | páginas, formulários, construtor, gráficos | `app/`, `components/` |
| Aplicação | casos de uso: validação (Zod), permissão, chamada ao banco, mensagens | `lib/proposals/actions.ts`, `data.ts`, `dashboard.ts` |
| Domínio | cálculo, conteúdo seguro, snapshot, filtros, formatação | `lib/proposals/pricing.ts`, `content.ts`, `snapshot.ts`, `filters.ts`, `format.ts` |
| Infraestrutura | Supabase, PDF, e-mail, tokens | `lib/supabase`, `lib/proposals/pdf`, `email.ts`, `tokens.ts`, `public.ts` |

A estrutura `src/` do prompt original **não** é usada: o Core do Pack (autenticação, organização, papéis, auditoria, LGPD) fica na raiz e é sincronizado em todos os sistemas por `scripts/sync-core.mjs`. Mudar o layout quebraria as atualizações do Core.

## Decisões
1. **Regras no banco, não só no app.** Cálculo, estados, imutabilidade, limites de desconto, aceite e expiração vivem em SQL/gatilhos e têm testes de banco. O app valida de novo (Zod) por conforto e mensagens.
2. **Snapshot imutável.** Ao publicar, o banco grava um JSON com empresa, cliente, itens, valores, texto e modelo. Tela, PDF e página pública leem só dele: mudar catálogo, cliente ou configurações depois não altera nada publicado.
3. **Um motor de PDF.** `@react-pdf/renderer` (servidor, Node). PDFme não foi adotado: o conteúdo é estruturado e o layout vem de 3 modelos (ver `OPEN_SOURCE_AUDIT.md`). Fontes padrão do PDF; caracteres fora do alfabeto latino viram «?» (limitação documentada). *Detalhe técnico:* `lineHeight` na página faz o react-pdf descartar o rodapé com número de página; por isso fica num contêiner do corpo.
4. **Conteúdo é dado, não HTML.** O texto das seções é ProseMirror JSON validado por esquema (`content.ts`): só parágrafo, títulos 2/3, listas, negrito, itálico, link http/https/mailto e separador. Renderização por componentes; não existe `dangerouslySetInnerHTML`.
5. **Link público sem enumeração.** Token de 256 bits; só o SHA-256 no banco; respostas idênticas para inexistente/revogado/vencido; limite de taxa por visitante; `noindex` e `Referrer-Policy: no-referrer`.
6. **Logotipo no banco** (data URL PNG/JPEG, ≤ 300 KB, conferido pelos bytes) em vez de Storage: a revisão publicada leva o logotipo da época e o PDF público não depende de outro serviço.
7. **CSP estrita:** gráficos (Recharts) e editor (Tiptap, `injectCSS: false`) só no navegador; cores do documento por folha de estilo do próprio domínio (`/p/theme.css`); sem estilo em linha.
8. **E-mail desacoplado:** interface `EmailProvider`; sem configuração nada é enviado e a tela diz isso. Resend por HTTP incluído (sem dependência).
9. **Reordenação por botões** (↑ ↓) em vez de arrastar: acessível por teclado e sem biblioteca extra.
10. **Rotas públicas por sistema:** `lib/security/public-prefixes.ts` (mecanismo do Core) libera só `/p/`.

## Fluxo principal
`criar proposta` (função) → `construtor` salva rascunho (função calcula e grava) → `publicar` (valida, limite de desconto, snapshot, status «enviada», revoga links antigos) → `link seguro` → cliente abre (`viewed`) → `aceita/recusa` (transação serializada) → painel e relatórios (funções SQL).

## Extensão (personalização)
Nome, cores, logotipo, prefixo de numeração, validade, condições padrão, limites de desconto e alertas: **Configurações**. Modelos: tabela `proposal_templates`. Novo campo: `custom jsonb`. Nova regra: migração + teste em `supabase/tests/`. Guia: `guias/personalizacao.md` do Pack.
