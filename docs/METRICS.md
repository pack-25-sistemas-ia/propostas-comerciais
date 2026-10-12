# METRICS — Definição dos indicadores

Regras gerais
- **Fuso:** `America/Sao_Paulo`. Período `[de, até]` por datas inclusivas (00:00:00 de `de` até 23:59:59.999 de `até`).
- **Dinheiro:** centavos inteiros (`bigint`); soma em banco, exibição em BRL.
- **Fonte única:** funções SQL `security invoker` com `p_org` (`prop_kpis`, `prop_series`, …), testadas com fixtures. A interface só formata.
- **Sem dados:** divisão por zero ou conjunto vazio devolve `null` e a tela mostra «sem dados», nunca 0 fingindo resultado.
- **Permissão:** vendedor (`member`) vê só as próprias propostas (RLS); gestor, administrador e proprietário veem todas.
- **Filtros** (vendedor, cliente, status, tipo de item) valem para todos os indicadores e gráficos, salvo onde indicado. «Tipo de item» (produto/serviço) filtra propostas que contêm ao menos um item daquele tipo; os valores continuam sendo o total da proposta.
- **Eventos temporais** (tabela `proposal_events`): `created`, `sent` (primeira publicação da proposta), `accepted`, `declined`. A data de um indicador é a data do evento correspondente.
- **Valor da proposta** = `total_cents` da revisão considerada: a revisão publicada no momento do evento; para aceitas, a revisão efetivamente aceita.

## Indicadores

| Indicador | Fórmula | Data usada |
|---|---|---|
| Propostas criadas | contagem de propostas (revisões **não** contam) | evento `created` |
| Propostas enviadas | contagem de propostas com **primeiro** `sent` no período | primeiro `sent` |
| Propostas aceitas | contagem de decisões `accepted` | data da decisão |
| Valor aceito | Σ `total_cents` das revisões aceitas | data da decisão. Não é faturamento. |
| Valor em negociação | Σ `total_cents` da revisão publicada das propostas `sent` ou `viewed` com `valid_until >= hoje` | **instantâneo atual** (não depende do período) |
| Taxa de aceite | `aceitas / (aceitas + recusadas) × 100` | decisões no período; `null` se o denominador for 0 |
| Ticket médio aceito | `valor aceito / nº de aceitas` | decisões no período; `null` sem aceitas |
| Tempo médio até decisão | média de (data da decisão − primeiro `sent`) das propostas decididas no período | em dias; propostas sem decisão não entram |

## Gráficos
| Gráfico | O que mede | Agrupamento |
|---|---|---|
| 1 Evolução de propostas | criadas e enviadas por bucket | semana se o período ≤ 90 dias, senão mês (segunda-feira como início) |
| 2 Aceitas × recusadas | decisões por bucket | idem |
| 3 Valor proposto × valor aceito | Σ valor das propostas **enviadas** no bucket (data do primeiro `sent`) × Σ valor aceito no bucket (data da decisão). São coortes diferentes por definição: o aceito de um mês pode vir de propostas enviadas antes. | idem |
| 4 Distribuição por status | contagem por status **atual** das propostas criadas no período | — |
| 5 Desempenho por vendedor | enviadas, aceitas e valor aceito por responsável | período |
| 6 Ranking de clientes | maior valor aceito no período | top 10 |
| 7 Evolução da taxa de aceite | taxa por bucket usando a **data da decisão** (não a coorte de envio); bucket sem decisões = `null` | idem |

## Alertas (limites em `proposal_settings`)
| Alerta | Regra | Padrão |
|---|---|---|
| Próxima do vencimento | `sent`/`viewed` com `valid_until` entre hoje e hoje + N dias | 7 |
| Vencida | `valid_until < hoje` e ainda sem decisão | — |
| Sem retorno | `sent` ou `viewed` há mais de N dias desde o primeiro envio, sem decisão | 5 |
| Aceita recentemente | aceite nos últimos N dias | 7 |

**Expiração:** o status `expired` é gravado por `expire_overdue_proposals(org)` (chamada ao abrir painel, lista e página pública). A decisão do cliente é recusada pelo banco se `valid_until < hoje`, mesmo antes dessa gravação.

## Precificação (ordem exata; implementação SQL e TypeScript com as mesmas fixtures)
1. Bruto do item = `round_half_up(quantidade × preço unitário)`.
2. Desconto do item: percentual → `round_half_up(bruto × pct / 100)`; fixo em centavos. Nunca maior que o bruto.
3. Líquido do item = bruto − desconto.
4. Subtotal = Σ líquidos.
5. Desconto global: percentual sobre o subtotal ou fixo; nunca maior que o subtotal.
6. Base = subtotal − desconto global.
7. Encargos: cada um percentual sobre a **base** ou fixo, arredondados individualmente.
8. Total = base + Σ encargos. Sem regra tributária.

`round_half_up` arredonda meio centavo para cima (valores não negativos). Quantidade tem até 4 casas decimais; percentuais até 2 casas.
