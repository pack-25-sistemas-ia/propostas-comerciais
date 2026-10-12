# DATABASE — Gestão de Propostas Comerciais

Migrações (em ordem): as três do Core (fundação, perfis, MFA) e as do sistema em `supabase/migrations/`:
`20270201000000_proposals_schema.sql` (tabelas, cálculo, regras, RLS), `…000100_proposals_flow.sql` (funções do fluxo e acesso público), `…000200_proposals_metrics.sql` (indicadores).
Toda tabela tem `organization_id` e **RLS ativa**. Dinheiro em **centavos** (`bigint`); quantidade `numeric(14,4)`; percentuais com até 2 casas.

## Tabelas

| Tabela | Função | Pontos de atenção |
|---|---|---|
| `proposal_settings` | 1 por organização: dados da empresa, numeração (`number_prefix`, `last_number`), validade padrão, condições padrão, cores, logotipo (PNG/JPEG em `data:` até ~300 KB), limites de desconto por perfil, dias dos alertas | só owner/admin alteram; `last_number` não é gravável pelo app |
| `proposal_templates` | modelos visuais (`base`: corporate, agency, technical; `structure_json`, `style_json`, `is_default`) | um único padrão por organização (gatilho) |
| `clients` | clientes (empresa ou pessoa) | CPF/CNPJ só com dígitos, único entre ativos; e-mail normalizado; sem exclusão (arquiva-se) |
| `catalog_items` | produtos e serviços com preço padrão | SKU único (sem diferenciar maiúsculas); sem exclusão (desativa-se) |
| `proposals` | a proposta: número, título, status, cliente, responsável, `current_revision_id` (última, rascunho ou publicada), `published_revision_id` (a que o cliente vê), `first_sent_at` | status e número só mudam por função; máquina de estados validada por gatilho |
| `proposal_revisions` | versões. `content_json` (seções), desconto, encargos, totais, datas, `snapshot_json` + `published_at` | publicada = **imutável** (gatilho) |
| `proposal_items` | itens da revisão (cópia dos dados comerciais; `catalog_item_id` opcional) | itens de revisão publicada são imutáveis |
| `proposal_events` | linha do tempo (somente inserção) | ninguém recebe UPDATE/DELETE |
| `proposal_share_links` | links: **só o hash SHA-256** do token, expiração, revogação | o token nunca é gravado |
| `proposal_decisions` | aceite/recusa: nome, e-mail, comentário, data | `revision_id` único: uma decisão por revisão; **sem IP nem user-agent** (minimização) |
| `proposal_email_deliveries` | tentativas de e-mail (`not_configured`, `sent`, `failed`) | |
| `commercial_goals` | metas de valor aceito por vendedor e período | |
| `audit_log` (Core) | metadados de alterações (nunca valores) | |

## Cálculo (fonte única no banco)
`public.prop_compute(itens, desconto, encargos)` é uma função **pura** que devolve todos os valores. Ordem: bruto do item → desconto do item → líquido → subtotal → desconto geral → base → encargos (percentual sobre a base) → total. Meio centavo arredonda para cima. Valida entradas (quantidade > 0 com até 4 casas, preço inteiro ≥ 0, percentuais de 0 a 100 com 2 casas, limites). O motor TypeScript (`lib/proposals/pricing.ts`) é um **espelho** para a prévia do editor; as duas implementações passam nas mesmas fixtures calculadas à mão (`tests/fixtures/pricing-cases.json`). Detalhes em `docs/METRICS.md`.

## Funções do fluxo (única porta de escrita)
Todas `security definer` com `search_path = ''`, verificando papel, responsável e MFA **dentro** da função:
`prop_create_proposal`, `prop_save_draft` (payload parcial; totais calculados aqui), `prop_publish_revision` (valida, aplica o limite de desconto do perfil, monta o **snapshot** com empresa, cliente, itens, valores e texto), `prop_create_revision`, `prop_cancel`, `prop_duplicate`, `prop_create_share_link`, `prop_revoke_share_link`, `prop_expire_overdue`.

## Acesso público
Duas funções, as **únicas** executáveis por `anon` (marcadas `PUBLIC_ENDPOINT` no catálogo do Postgres; o teste do Core falha se houver outra): `prop_public_view(hash)` e `prop_public_decide(hash, …)`. Link inexistente, revogado ou vencido responde igual (`unavailable`). A decisão trava a linha da proposta (`for update`), valida revisão vigente, link, validade e status, e grava decisão e evento na mesma transação.

## Máquina de estados
`draft → sent → viewed → accepted | declined | expired | cancelled`. Permitido também: `sent/viewed/declined/expired → sent` (nova revisão publicada), `* → cancelled` (exceto aceita). `accepted` e `cancelled` são definitivos. Visualizar **não** é aceitar. Expiração é gravada por `prop_expire_overdue` (painel, listas e página pública) e a decisão é recusada pelo banco mesmo antes disso.

## Permissões (RLS)
| Papel | Propostas | Clientes | Catálogo | Configurações |
|---|---|---|---|---|
| owner / admin | tudo | escreve | escreve | escreve (MFA obrigatório) |
| manager (gestor) | tudo, define metas | escreve | escreve | lê |
| member (vendedor) | só as próprias | escreve | lê | lê |
| viewer (leitor) | lê tudo | lê | lê | lê |

## Campos extensíveis
`custom jsonb` (objeto, até 8 KB) em clientes, catálogo, propostas e configurações. Coluna própria + migração nova quando houver filtro ou relatório.

## Testes de banco (`pnpm test:db`, Postgres 17 descartável)
`60_prop_pricing_fixtures` (motor), `61_prop_rls` (isolamento e papéis), `62_prop_flow` (rascunho, publicação, imutabilidade, revisões, limites, expiração), `63_prop_public` (token, visualização, aceite, recusa, revogação, substituição, vencimento), `64_prop_metrics` (indicadores, filtros, bordas, alertas, metas). Verificados por **mutação**: 14 regras críticas foram quebradas de propósito e a suíte reprovou todas.
