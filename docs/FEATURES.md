# FEATURES — Gestão de Propostas Comerciais

Estados usados: VERIFIED (com evidência), PENDENTE ou NÃO EXECUTADO. Evidências em `tests/e2e/` (E2E), `tests/unit/` (unitários) e `supabase/tests/` (banco).
Siglas: **FLOW** `prop-flow.spec.ts` · **LIFE** `prop-lifecycle.spec.ts` · **SEC** `prop-security.spec.ts` · **DASH** `prop-dashboard.spec.ts` · **PDF** `prop-pdf.test.ts` · **PRC** `prop-pricing.test.ts` · **LIB** `prop-lib.test.ts` · **CNT** `prop-content.test.ts` · **DB60–64** testes de banco.

## Funcionalidades
| Fluxo | Status | Evidência |
|---|---|---|
| Autenticação, organização, papéis, MFA, recuperação de senha | VERIFIED | Core: `core-flow`, `email-flows`, `security` (E2E) + DB 10–40 |
| Clientes (cadastro, validação CPF/CNPJ, arquivar, busca, importar/exportar CSV) | VERIFIED | FLOW «cadastro»; SEC «CSV»; LIB |
| Catálogo (criar, editar, desativar, duplicar, copiar para a proposta) | VERIFIED | FLOW «cadastro»; DB62 (catálogo não altera publicada) |
| Construtor: itens, descontos, encargos, seções, validade, salvar, prévia, aviso de alterações | VERIFIED | FLOW «construtor»; LIFE «alterações não salvas» |
| Motor de cálculo (banco + espelho TypeScript) | VERIFIED | DB60 e PRC (mesmas 16 fixtures à mão + 14 inválidas); LIB |
| Editor de texto (Tiptap) e conteúdo seguro | VERIFIED | FLOW; CNT; SEC «XSS» |
| 3 modelos visuais; trocar não apaga conteúdo | VERIFIED | LIFE; PDF (3 modelos) |
| PDF A4 (rascunho e publicada), paginação, acentos, rodapé | VERIFIED | PDF (lido de volta com pdf.js); FLOW; SEC «logotipo» |
| Versões imutáveis e histórico | VERIFIED | DB62; LIFE «nova revisão» |
| Máquina de estados e limites de desconto por perfil | VERIFIED | DB62 (gatilho e bordas 10,00/10,01%) |
| Link seguro, visualização, aceite e recusa, revogação, expiração | VERIFIED | DB63; FLOW; LIFE; SEC «link público» |
| Decisão concorrente (uma só gravada) | VERIFIED | LIFE «duas decisões ao mesmo tempo»; DB63 |
| Notificações: histórico no painel; e-mail desacoplado e registrado | VERIFIED (e-mail real: BLOQUEADO — exige credencial do provedor) | FLOW (histórico); `email.ts`; sem provedor a tela avisa que nada foi enviado |
| Painel: 8 indicadores, 7 gráficos, filtros, alertas, metas | VERIFIED | DASH; DB64 |
| Relatórios (9) com CSV | VERIFIED | DASH «relatórios» |
| Configurações, logotipo, usuários (Equipe do Core), perfil | VERIFIED | SEC «logotipo»; Core `/members` |
| Dados de demonstração | VERIFIED | `supabase/seed.sql` (DASH roda sobre ele) |
| Instalação isolada | VERIFIED | `export-system.mjs` → install, lint, tipos, unit, build, `test:db`, E2E na cópia |

## Testes obrigatórios (seção 27 do prompt)
| Grupo | Itens | Status | Evidência |
|---|---|---|---|
| Autenticação | cadastro, login, logout, recuperação, sessões, permissões | VERIFIED | Core E2E; SEC (papéis) |
| Clientes | criar, editar, arquivar, buscar, importar, exportar | VERIFIED | FLOW; SEC «CSV»; LIB |
| Catálogo | criar, editar preço, desativar, selecionar na proposta | VERIFIED | FLOW; DB61 |
| Propostas | rascunho, salvar, editar, itens, descontos, duplicar, publicar, revisões | VERIFIED | FLOW; LIFE; DB62 |
| Cálculos | subtotal, % e fixo, fracionárias, encargos, arredondamento, total, valores altos, negativos, zerado, duplicados | VERIFIED | DB60, PRC (inclui propriedades com 400 casos aleatórios) |
| Documentos | gerar PDF, reproduzir revisão, conteúdo, totais, paginação | VERIFIED | PDF |
| Compartilhamento | gerar, acessar, revogar, expirar, impedir acesso indevido | VERIFIED | SEC; LIFE; DB63 |
| Decisões | aceitar, recusar, duplicidade, revisão antiga, histórico | VERIFIED | DB63; LIFE; FLOW |
| Dashboard | indicadores, período, vendedor, gráficos, taxa, valor aceito, alertas | VERIFIED | DASH; DB64 |
| Segurança | isolamento, RLS, permissões, validação, upload, links, credenciais, vazamento | VERIFIED | SEC; DB61; `check-no-secrets` |
| Qualidade | build, lint, tipos, testes, mobile, carregamento, erros, execução independente | VERIFIED | CI; DASH «mobile»; instalação isolada |

## Limitações conhecidas
- Aceite = confirmação comercial simples (nome, e-mail, data); **não** é assinatura eletrônica certificada.
- PDF usa fontes padrão: texto fora do alfabeto latino vira «?».
- Contagem de visualizações não é exata (prévias de mensageiros podem contar; há heurística).
- Rate limit do app é por instância (padrão do Core).
- Envio de e-mail real não foi testado (sem credenciais).
