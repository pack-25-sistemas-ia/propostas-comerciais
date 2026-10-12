import { test } from '@playwright/test';
import { uiLogin } from './helpers';

// Capturas para revisão visual (dados de demonstração). Saída: test-results/screens/ (não roda no CI: grep-invert "capturas")
const VIEWS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, colorScheme: 'light' as const },
  { name: 'mobile', viewport: { width: 390, height: 844 }, colorScheme: 'light' as const },
  { name: 'dark', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' as const },
];

for (const v of VIEWS) {
  test(`capturas ${v.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: v.viewport, colorScheme: v.colorScheme });
    const page = await ctx.newPage();
    const shot = async (n: string) => {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `test-results/screens/${v.name}-${n}.png`, fullPage: true });
    };
    await uiLogin(page, 'gerente@demo.exemplo', 'DemoLocal#2026');
    await page.waitForURL('**/dashboard');
    for (const [n, path] of [['dashboard', '/dashboard?period=90d'], ['propostas', '/propostas'], ['clientes', '/clientes'], ['catalogo', '/catalogo'], ['modelos', '/modelos'], ['relatorios', '/relatorios?period=90d'], ['metas', '/metas']] as const) {
      await page.goto(path);
      await shot(n);
    }
    // proposta aceita (documento + versões + histórico)
    await page.goto('/propostas?status=accepted');
    await page.getByRole('table', { name: 'Propostas' }).getByRole('link').first().click();
    await shot('proposta-aceita');
    // proposta em aberto: gerar o link e abrir como cliente
    await page.goto('/propostas?status=viewed');
    await page.getByRole('table', { name: 'Propostas' }).getByRole('link').first().click();
    await page.getByRole('button', { name: 'Criar link' }).click();
    const url = await page.getByLabel('Link da proposta').inputValue();
    await shot('proposta-aberta');
    const anon = await browser.newContext({ viewport: v.viewport, colorScheme: v.colorScheme });
    const pub = await anon.newPage();
    await pub.goto(url);
    await pub.waitForTimeout(800);
    await pub.screenshot({ path: `test-results/screens/${v.name}-publica.png`, fullPage: true });
    await anon.close();
    // editor de um rascunho, em cada aba
    await page.goto('/propostas?status=draft');
    await page.getByRole('table', { name: 'Propostas' }).getByRole('link').first().click();
    await page.getByRole('link', { name: 'Editar rascunho' }).click();
    await page.waitForURL(/\/editar$/);
    for (const [n, tab] of [['editor-info', 'Informações'], ['editor-itens', 'Itens e valores'], ['editor-conteudo', 'Conteúdo'], ['editor-previa', 'Pré-visualização']] as const) {
      await page.getByRole('tab', { name: tab }).click();
      await shot(n);
    }
    // cliente e configurações (dono)
    await page.goto('/clientes');
    await page.getByRole('table', { name: 'Clientes' }).getByRole('link').first().click();
    await shot('cliente');
    await ctx.close();

    const own = await browser.newContext({ viewport: v.viewport, colorScheme: v.colorScheme });
    const owner = await own.newPage();
    await uiLogin(owner, 'dono@demo.exemplo', 'DemoLocal#2026');
    await owner.waitForTimeout(1500);
    await own.close();
  });
}
