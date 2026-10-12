import { expect, test, type Page } from '@playwright/test';
import { uiLogin } from './helpers';
import { inDays, watchCsp } from './prop-helpers';

// Painel e relatórios com os dados de demonstração (seed determinístico). Valores conferidos contra o seed:
//   30 propostas; 28 enviadas; 14 aceitas = R$ 49.442,05; 6 recusadas; 6 em negociação = R$ 16.205,08.
const PERIOD = () => `/dashboard?period=custom&from=${inDays(-120)}&to=${inDays(0)}`;
const card = (page: Page, label: string) => page.getByRole('region', { name: 'Indicadores' }).getByText(label, { exact: true }).locator('..');

async function login(page: Page, email: string) {
  await uiLogin(page, email, 'DemoLocal#2026');
  await page.waitForURL('**/dashboard');
}

test('gerente: indicadores batem com o seed, sete gráficos reais e alertas', async ({ page }) => {
  const violations = watchCsp(page);
  await login(page, 'gerente@demo.exemplo');
  await page.goto(PERIOD());
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
  await expect(card(page, 'Propostas criadas')).toContainText('30');
  await expect(card(page, 'Propostas enviadas')).toContainText('28');
  await expect(card(page, 'Propostas aceitas')).toContainText('14');
  await expect(card(page, 'Valor aceito')).toContainText('R$ 49.442,05');
  await expect(card(page, 'Valor em negociação')).toContainText('R$ 16.205,08');
  await expect(card(page, 'Valor em negociação')).toContainText('6 proposta(s)');
  await expect(card(page, 'Taxa de aceite')).toContainText('70,00%');
  await expect(card(page, 'Taxa de aceite')).toContainText('14 aceita(s) ÷ (14 + 6 recusada(s))');
  await expect(card(page, 'Ticket médio aceito')).toContainText('R$ 3.531,58');
  await expect(card(page, 'Tempo até a decisão')).toContainText('4,7 dias');
  // período anterior sem dados: a variação não é inventada
  await expect(page.getByText('vs período anterior')).toHaveCount(0);

  const titles = ['Evolução de propostas', 'Aceitas × recusadas', 'Valor proposto × valor aceito', 'Distribuição por status', 'Desempenho por vendedor', 'Ranking de clientes', 'Evolução da taxa de aceite'];
  for (const t of titles) await expect(page.getByRole('region', { name: t })).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  expect(await page.locator('.recharts-surface').count()).toBeGreaterThanOrEqual(6);

  // tabela alternativa acessível, com os mesmos dados
  const status = page.getByRole('region', { name: 'Distribuição por status' });
  await status.getByText('Ver dados em tabela').click();
  await expect(status.getByRole('row', { name: /Aceita/ })).toContainText('14');
  await expect(status.getByRole('row', { name: /Recusada/ })).toContainText('6');
  await expect(status.getByRole('row', { name: /Rascunho/ })).toContainText('2');
  const reps = page.getByRole('region', { name: 'Desempenho por vendedor' });
  await reps.getByText('Ver dados em tabela').click();
  await expect(reps.getByRole('table')).toContainText('Camila Vendas');
  await expect(reps.getByRole('table')).toContainText('Diego Vendas');

  // alertas calculados do banco
  const alerts = page.getByRole('region', { name: 'Alertas e metas' });
  await expect(alerts.getByRole('heading', { name: /Próximas do vencimento/ })).toContainText('1');
  await expect(alerts.getByRole('heading', { name: /Vencidas/ })).toContainText('2');
  await expect(alerts.getByRole('heading', { name: /Sem retorno/ })).toContainText('5');
  await expect(alerts.getByRole('heading', { name: /Aceitas recentemente/ })).toContainText('1');
  await expect(alerts.getByRole('progressbar', { name: /Progresso da meta de Camila Vendas/ })).toBeVisible();
  expect(violations).toEqual([]);
});

test('filtro por vendedor muda os números; vendedor vê só o dele; leitor vê tudo', async ({ page, browser }) => {
  await login(page, 'gerente@demo.exemplo');
  await page.goto(PERIOD());
  await page.getByLabel('Vendedor', { exact: true }).selectOption({ label: 'Camila Vendas' });
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await page.waitForURL(/owner=/);
  await expect(card(page, 'Propostas criadas')).toContainText('12');
  const rep = page.getByRole('region', { name: 'Desempenho por vendedor' });
  await rep.getByText('Ver dados em tabela').click();
  await expect(rep.getByRole('table')).not.toContainText('Diego Vendas');

  const ctx = await browser.newContext();
  const seller = await ctx.newPage();
  await login(seller, 'vendedor1@demo.exemplo');
  await seller.goto(PERIOD());
  await expect(card(seller, 'Propostas criadas')).toContainText('12');
  await expect(seller.getByText('Você vê os números das suas próprias propostas.')).toBeVisible();
  await expect(seller.getByLabel('Vendedor', { exact: true })).toHaveCount(0);
  await seller.goto('/propostas');
  await expect(seller.getByText(/\d+ registro\(s\)/)).toContainText('12 registro(s)');
  await ctx.close();

  const ctx2 = await browser.newContext();
  const viewer = await ctx2.newPage();
  await login(viewer, 'leitor@demo.exemplo');
  await viewer.goto(PERIOD());
  await expect(card(viewer, 'Propostas criadas')).toContainText('30');
  await expect(viewer.getByRole('link', { name: 'Nova proposta' })).toHaveCount(0);
  await ctx2.close();
});

test('período sem dados mostra "sem dados" (nunca zero fingindo resultado); filtros inválidos caem no padrão', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  await page.goto('/dashboard?period=custom&from=2020-01-01&to=2020-01-31');
  await expect(page.getByText('Ainda não há propostas neste período.')).toBeVisible();
  await expect(card(page, 'Taxa de aceite')).toContainText('—');
  await expect(card(page, 'Taxa de aceite')).toContainText('Sem propostas decididas no período');
  await expect(card(page, 'Ticket médio aceito')).toContainText('—');
  await expect(card(page, 'Tempo até a decisão')).toContainText('—');
  await expect(card(page, 'Valor aceito')).toContainText('R$ 0,00');
  await expect(card(page, 'Valor em negociação')).toContainText('R$ 16.205,08'); // situação atual, não depende do período
  await expect(page.getByRole('region', { name: 'Evolução de propostas' })).toContainText('Sem dados no período selecionado');
  for (const qs of ['period=custom&from=lixo&to=2020-99-99', 'period=xyz', 'owner=1%27%20or%201=1--&client=x&status=hack&type=y', 'period=custom&from=2026-09-30&to=2026-09-01']) {
    const res = await page.goto(`/dashboard?${qs}`);
    expect(res!.status(), qs).toBe(200);
    await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
    await expect(page.getByText('Não foi possível carregar os indicadores')).toHaveCount(0);
  }
});

test('relatórios: tabelas, status, vendedores e exportações CSV', async ({ page }) => {
  await login(page, 'gerente@demo.exemplo');
  await page.goto(PERIOD().replace('/dashboard', '/relatorios'));
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
  const status = page.getByRole('table', { name: 'Propostas por status' });
  await expect(status.getByRole('row', { name: /Aceita/ })).toContainText('14');
  await expect(status.getByRole('row', { name: /Expirada/ })).toContainText('2');
  const reps = page.getByRole('table', { name: 'Propostas por vendedor' });
  await expect(reps).toContainText('Camila Vendas');
  await expect(page.getByRole('table', { name: 'Propostas vencidas' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Propostas pendentes' })).toBeVisible();

  const csv = await (await page.request.get('/export/proposals')).text();
  const lines = csv.trim().split('\r\n');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(lines[0]).toBe('"Número";"Título";"Cliente";"Status";"Versão";"Valor (R$)";"Válida até";"Responsável";"Primeiro envio";"Criada em"');
  expect(lines).toHaveLength(31); // cabeçalho + 30
  const rep = await (await page.request.get(`/export/sales-by-rep?period=custom&from=${inDays(-120)}&to=${inDays(0)}`)).text();
  expect(rep).toContain('"Camila Vendas";');
  const series = await (await page.request.get(`/export/series?period=custom&from=${inDays(-120)}&to=${inDays(0)}`)).text();
  expect(series.trim().split('\r\n').length).toBeGreaterThan(3);
});

test('mobile: sem rolagem horizontal no painel, lista, proposta e editor', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await login(page, 'gerente@demo.exemplo');
  const noOverflow = async (path: string) => {
    await page.goto(path);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200); // gráficos carregam depois
    const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(w.s, `${path}: scrollWidth ${w.s} > ${w.c}`).toBeLessThanOrEqual(w.c);
  };
  await noOverflow(PERIOD());
  await noOverflow('/propostas');
  await noOverflow('/clientes');
  await noOverflow('/relatorios');
  await page.goto('/propostas?q=00001');
  await page.getByRole('link', { name: '00001', exact: true }).click();
  await noOverflow(page.url().replace(/^https?:\/\/[^/]+/, ''));
  // editor de um rascunho
  await page.goto('/propostas?status=draft');
  await page.getByRole('link', { name: /^0000\d$|^0001\d$|^0002\d$|^00030$/ }).first().click();
  await page.getByRole('link', { name: 'Editar rascunho' }).click();
  await page.waitForURL(/\/editar$/);
  for (const tab of ['Informações', 'Itens e valores', 'Conteúdo', 'Pré-visualização']) {
    await page.getByRole('tab', { name: tab }).click();
    const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(w.s, `editor/${tab}: ${w.s} > ${w.c}`).toBeLessThanOrEqual(w.c);
  }
  await ctx.close();
});
