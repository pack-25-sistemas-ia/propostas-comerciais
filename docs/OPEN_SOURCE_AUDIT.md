# OPEN_SOURCE_AUDIT — Gestão de Propostas Comerciais

Consulta feita em 2026-10-12 (metadados pela API do GitHub e `npm view`). «Incorporado» = código copiado para este repositório; o que é só **dependência** instalada via pnpm aparece em `THIRD_PARTY_NOTICES.md`.

## Referências avaliadas

| Projeto | URL | Licença | Commit consultado | Última atividade | Decisão |
|---|---|---|---|---|---|
| react-pdf | github.com/diegomura/react-pdf | MIT | `e7b14db1e5` | 2026-10-07 | **Usar como dependência** (`@react-pdf/renderer` 4.9.0). Único motor de PDF. |
| PDFme | github.com/pdfme/pdfme | MIT | `f5e9d8384e` | 2026-10-09 | **Não adotar no MVP.** Seu valor é o designer WYSIWYG de posicionamento livre; nosso conteúdo é estruturado (seções, tabela de itens) e o layout vem de 3 modelos. Usar dois motores seria complexidade sem ganho. Reavaliar se um cliente pedir editor visual de modelo. |
| Tiptap | github.com/ueberdosis/tiptap | MIT (núcleo) | `5e4c112378` | 2026-10-12 | **Usar como dependência** (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` 3.31.4). Só extensões MIT; nenhuma extensão Pro/Cloud. |
| invoice-builder | github.com/piratuks/invoice-builder | MIT | `10bbddad6b` | 2026-10-05 | **Referência de UX** (fluxo de itens e totais). Nada copiado: é Angular + MongoDB, arquitetura incompatível. |
| FOSSBilling | github.com/FOSSBilling/FOSSBilling | Apache-2.0 | `8fb94eb95f` | 2026-10-12 | **Referência de modelagem** (catálogo, clientes). É PHP; nada copiado. |
| React Email | github.com/resend/react-email | MIT | `1531a395bf` | 2026-10-08 | **Referência.** Os e-mails são texto simples gerado no servidor, desacoplado de provedor; sem a dependência. |
| nextjs/saas-starter | github.com/nextjs/saas-starter | MIT | ver `docs/REFERENCE_AUDIT.md` do hub | 2025-12 | **Referência** de organização SaaS. O Core do Pack já cobre autenticação, organização e papéis. Nada copiado. |
| shadcn/ui | github.com/shadcn-ui/ui | MIT | ver hub | 2026-10 | **Não incorporado.** O Core tem primitivos próprios (`components/ui/primitives.tsx`) com acessibilidade equivalente; a CLI traria Radix e muitas dependências para o MVP. |

## Dependências adicionadas por este sistema (sobre o Core)

| Pacote | Versão | Licença | Uso |
|---|---|---|---|
| @react-pdf/renderer | 4.9.0 | MIT | PDF A4 no servidor |
| @tiptap/react, @tiptap/pm, @tiptap/starter-kit | 3.31.4 | MIT | editor de escopo (no navegador) |
| recharts | 3.10.1 | MIT | gráficos do painel |
| react-hook-form, @hookform/resolvers | 7.89.0, 5.9.1 | MIT | formulários |
| @tanstack/react-table | 8.21.3 | MIT | tabelas |
| papaparse | 5.7.0 | MIT | importação de CSV de clientes |
| pdfjs-dist (somente testes) | 6.4.299 | Apache-2.0 | ler o PDF de volta nos testes (texto, páginas, rodapé) |

Não adotados: `date-fns` (o `Intl` do Node e do navegador cobre o necessário) e `lucide-react` (ícones são SVG inline, sem dependência).

## Riscos e decisões
- **@react-pdf/renderer** é pesado e roda só no servidor (Node), nunca no navegador. As fontes padrão (Helvetica) cobrem os acentos do português. Sem scripts de instalação.
- **Tiptap** gera ProseMirror JSON. **Não** armazenamos nem renderizamos HTML: o JSON é validado por esquema (nós e marcas permitidos; links só http/https/mailto) e renderizado por componentes próprios.
- Arquivos de terceiros incorporados a este repositório: **nenhum**.
