# PLANO DE IMPLEMENTAÇÃO — Gestão de Propostas Comerciais

Prompt de origem: «Prompt Mestre — Sistema 02 v2.0». Este plano registra como ele foi interpretado dentro das decisões do Pack (ver `docs/DECISIONS.md` do hub: Core sincronizado, repositório por sistema, sem convite por e-mail no MVP).

## 1. Objetivo e público-alvo
Criar, versionar, enviar e acompanhar propostas comerciais, com cálculo confiável, PDF, link seguro de aceite e indicadores. Público: agências, consultorias, empresas de tecnologia, prestadores de serviço, manutenção, engenharia/arquitetura, distribuidoras, representantes e PMEs B2B.

## 2. Problemas resolvidos
Propostas em Word/Excel; valores errados; preços desatualizados; sem histórico de versões; sem status; sem padrão visual; sem indicadores (taxa de aceite, valor em negociação).

## 3. Repositórios de referência
Ver `docs/OPEN_SOURCE_AUDIT.md`. Usados como dependência: react-pdf (PDF) e Tiptap (editor). Referências de UX/modelagem: invoice-builder, FOSSBilling, saas-starter. Não adotados: PDFme (um só motor de PDF), shadcn/ui (o Core já tem primitivos).

## 4. Funcionalidades obrigatórias
Clientes (CRUD, arquivar, CSV) · Catálogo (produtos e serviços) · Construtor de proposta (itens, descontos, encargos, seções, validade, condições) · 3 modelos visuais · Versões imutáveis · PDF A4 · Link seguro com aceite/recusa · Notificações internas e registro de e-mail · Dashboard (8 indicadores, 7 gráficos, filtros, alertas) · Relatórios com CSV · Configurações da empresa · Metas · Dados de demonstração.

## 5. Páginas e navegação (rotas em português, como o prompt)
`/dashboard` · `/propostas` · `/propostas/nova` · `/propostas/[id]` (visualizar, histórico, revisões, compartilhar) · `/propostas/[id]/editar` · `/clientes` · `/clientes/[id]` · `/catalogo` · `/modelos` · `/relatorios` · `/configuracoes` · `/usuarios` (membros do Core) · `/perfil` · `/p/[token]` (pública) · `/p/[token]/pdf`. Do Core: `/members`, `/privacy`, `/audit`.
> A estrutura `src/` do prompt **não** é usada: o Core (sincronizado por `sync-core`) fica na raiz (`app/`, `lib/`, `components/`). Mudar isso quebraria a atualização do Core em todos os sistemas.

## 6. Componentes de frontend
Tabela (TanStack) com busca, ordenação e paginação · construtor de proposta (client component com salvamento e aviso de alterações não salvas) · editor Tiptap · tabela de itens com reordenação por botões (acessível) · painel de totais (motor TypeScript espelhando o SQL) · seletor de modelo · gráficos Recharts com tabela alternativa · barra de filtros · formulários RHF + Zod · diálogos acessíveis.

## 7. Entidades e relacionamentos
organização 1—N clientes, itens de catálogo, modelos, propostas · proposta 1—N revisões · revisão 1—N itens · proposta 1—N eventos, links, decisões, e-mails · usuário 1—N propostas (responsável) e metas. Detalhes em `docs/DATABASE.md`.

## 8. Banco de dados
Migração `supabase/migrations/20270201000000_proposals_schema.sql` (após as do Core). Tabelas: `proposal_settings`, `clients`, `catalog_items`, `proposal_templates`, `proposals`, `proposal_revisions`, `proposal_items`, `proposal_events`, `proposal_share_links`, `proposal_decisions`, `proposal_email_deliveries`, `commercial_goals` (+ `audit_log` do Core). Valores em centavos; numeração por organização; revisões publicadas imutáveis; mutações sensíveis só por funções.

## 9. Políticas de segurança (RLS)
Mesmo padrão do Core: RLS em toda tabela, privilégios por coluna, MFA (aal2) para escrita de owner/admin, funções `security definer` com `search_path = ''`. Perfis do prompt → papéis do Core: Administrador = owner/admin · Gestor = manager · Vendedor = member (só as próprias propostas) · Leitor = viewer. Anônimo só executa duas funções públicas (ver/decidir por token), sem acesso a tabelas.

## 10. Regras de negócio
Máquina de estados (rascunho → enviada → visualizada → aceita/recusada; expirada; cancelada) validada no banco · numeração sequencial por organização · publicar exige cliente, ao menos 1 item, validade futura · limite de desconto por perfil (configurável) · aceite só sobre a revisão publicada vigente, link ativo e proposta não expirada · uma decisão por revisão (concorrência segura) · alterar catálogo ou configurações nunca altera revisão publicada (snapshot).

## 11. Indicadores e fórmulas
`docs/METRICS.md`.

## 12. Gráficos e relatórios
7 gráficos do painel e 9 relatórios (`docs/METRICS.md`), todos com tabela alternativa e CSV.

## 13. Filtros
Período (7/30/90 dias e personalizado), vendedor, cliente, status, tipo de item.

## 14. Importações e exportações
Importar clientes por CSV (≤ 1 MB e 2.000 linhas, modo «apenas validar», duplicidade por e-mail ou documento). Exportar clientes, propostas e relatórios em CSV (UTF-8 com BOM, `;`, neutraliza fórmulas). PDF por revisão.

## 15. Testes de aceitação
Seção 27 do prompt, mapeada em `docs/FEATURES.md` a um teste (pg-test, unitário ou E2E) por item. Fixtures determinísticas de cálculo compartilhadas entre SQL e TypeScript.

## 16. Critérios de conclusão
Seção 31 do prompt + gates do Pack: `docs/FEATURES.md` sem pendência, instalação isolada validada com `export-system.mjs`, CI verde, licenças e segredos verificados.

## 17. Exclusões do MVP
NF-e/NFS-e · contabilidade · cobrança/pagamento · assinatura eletrônica certificada · ERP/CRM completo · WhatsApp · IA paga · entrevista de personalização · convite por e-mail (membros entram pelo procedimento de `docs/MEMBROS.md` do hub).

## 18. Etapas
1. Diagnóstico e documentos (este plano, auditoria, métricas, banco). 2. Banco: migração, funções, RLS, testes pg (cálculo, estados, imutabilidade, isolamento, público). 3. Motor de cálculo TS + fixtures. 4. Clientes e catálogo. 5. Construtor, editor e modelos. 6. PDF e versões. 7. Link público, aceite e recusa. 8. Painel e relatórios. 9. Demonstração, E2E, mobile, capturas. 10. Instalação isolada, documentação, memória e CI.
