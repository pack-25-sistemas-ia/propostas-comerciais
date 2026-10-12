import { expect, test, type Page } from '@playwright/test';
import { inDays, setupOwner, watchCsp, type Owner } from './prop-helpers';

// Fluxo comercial ponta a ponta com valores calculados à mão:
//   Consultoria 10 x 150,00 = 1500,00 com 4% = −60,00 → 1440,00 · Licença 2 x 499,00 = 998,00
//   subtotal 2438,00 · desconto geral 5% = 121,90 · base 2316,10 · frete 10,00 · TOTAL 2326,10
test.describe.configure({ mode: 'serial' });

let owner: Owner;
let proposalId = '';
let shareUrl = '';
const TOTAL = 'R$ 2.326,10';

test.afterAll(async () => {
  await owner?.ctx.close();
});

async function fillItems(page: Page) {
  await page.getByRole('tab', { name: 'Itens e valores' }).click();
  await page.getByLabel('Adicionar do catálogo').selectOption({ label: 'Consultoria E2E — R$ 150,00' });
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByLabel('Quantidade').first().fill('10');
  await page.getByLabel('Desconto', { exact: true }).first().selectOption('percent');
  await page.getByLabel('Valor do desconto do item 1').fill('4');
  await page.getByRole('button', { name: 'Item avulso' }).click();
  await page.getByLabel('Item 2', { exact: true }).fill('Licença anual');
  await page.getByLabel('Quantidade').nth(1).fill('2');
  await page.getByLabel('Preço unitário (R$)').nth(1).fill('499,00');
  await page.getByLabel('Desconto geral').selectOption('percent');
  await page.getByLabel('Valor do desconto geral').fill('5');
  await page.getByRole('button', { name: 'Adicionar encargo' }).click();
  await page.getByLabel('Nome do encargo 1').fill('Frete');
  await page.getByLabel('Valor do encargo 1').fill('10,00');
}

test('cadastro: cliente e item de catálogo', async ({ browser }) => {
  owner = await setupOwner(browser, 'prop');
  const { page } = owner;
  const violations = watchCsp(page);

  await page.goto('/clientes/novo');
  await page.getByLabel('Nome', { exact: true }).fill('Cliente E2E Ltda');
  await page.getByLabel('CPF ou CNPJ').fill('11.222.333/0001-81');
  await page.getByLabel('E-mail').fill('cliente.e2e@example.test');
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Cliente E2E Ltda' })).toBeVisible();

  // CNPJ inválido é recusado
  await page.goto('/clientes/novo');
  await page.getByLabel('Nome', { exact: true }).fill('Cliente Inválido');
  await page.getByLabel('CPF ou CNPJ').fill('11.222.333/0001-82');
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('CPF ou CNPJ inválido.')).toBeVisible();

  await page.goto('/catalogo');
  await page.getByText('Novo item', { exact: true }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Consultoria E2E');
  await page.getByLabel('Código (opcional)').fill('E2E-1');
  await page.getByLabel('Unidade').fill('h');
  await page.getByLabel('Preço padrão (R$)').fill('150,00');
  await page.getByRole('button', { name: 'Cadastrar item' }).click();
  await expect(page.getByRole('link', { name: 'Consultoria E2E' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('construtor: itens, descontos, encargos e salvamento no banco', async () => {
  const { page } = owner;
  const violations = watchCsp(page);
  await page.goto('/propostas/nova');
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente E2E Ltda' });
  await page.getByLabel('Título da proposta').fill('Projeto E2E');
  await page.getByRole('button', { name: 'Criar proposta e abrir o editor' }).click();
  await page.waitForURL(/\/propostas\/[0-9a-f-]{36}\/editar$/);
  proposalId = page.url().match(/propostas\/([0-9a-f-]{36})/)![1]!;
  await expect(page.getByText('Proposta 00001')).toBeVisible();

  await page.getByLabel('Válida até').fill(inDays(20));
  await fillItems(page);
  await expect(page.getByTestId('total')).toHaveText(TOTAL);

  // texto do escopo (Tiptap)
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  const editor = page.getByRole('textbox', { name: 'Texto da seção Escopo' });
  await editor.click();
  await page.keyboard.type('Escopo detalhado do projeto E2E.');

  // alterações não salvas ficam sinalizadas; salvar limpa o sinal
  await expect(page.getByText('Alterações não salvas')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();
  await expect(page.getByText('Alterações não salvas')).toHaveCount(0);

  // persistiu: recarrega e confere itens, total e texto
  await page.reload();
  await page.getByRole('tab', { name: 'Itens e valores' }).click();
  await expect(page.getByLabel('Item 1', { exact: true })).toHaveValue('Consultoria E2E');
  await expect(page.getByTestId('total')).toHaveText(TOTAL);
  await page.getByRole('tab', { name: 'Pré-visualização' }).click();
  await expect(page.getByLabel('Proposta 00001').getByText('Escopo detalhado do projeto E2E.')).toBeVisible();
  await expect(page.getByLabel('Proposta 00001').getByRole('cell', { name: TOTAL })).toBeVisible();
  expect(violations).toEqual([]);
});

test('rascunho incompleto não gera PDF e o PDF do rascunho traz a faixa', async () => {
  const { page } = owner;
  const ok = await page.request.get(`/propostas/${proposalId}/pdf`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toBe('application/pdf');
  const body = await ok.body();
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  expect(body.length).toBeGreaterThan(2500);
  // proposta sem itens: recusa com o motivo
  await page.goto('/propostas/nova');
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente E2E Ltda' });
  await page.getByLabel('Título da proposta').fill('Proposta vazia');
  await page.getByRole('button', { name: 'Criar proposta e abrir o editor' }).click();
  await page.waitForURL(/\/propostas\/[0-9a-f-]{36}\/editar$/);
  const emptyId = page.url().match(/propostas\/([0-9a-f-]{36})/)![1]!;
  const res = await page.request.get(`/propostas/${emptyId}/pdf`);
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatch(/adicione ao menos um item/i);
});

test('publicar congela a versão, gera link seguro e PDF', async () => {
  const { page } = owner;
  await page.goto(`/propostas/${proposalId}/editar`);
  await page.getByRole('button', { name: 'Publicar' }).click();
  await page.waitForURL(/\/propostas\/[0-9a-f-]{36}\?published=1$/);
  await expect(page.getByText('Proposta publicada.')).toBeVisible();
  await expect(page.getByText('Enviada').first()).toBeVisible();
  // revisão publicada não abre mais no editor
  await page.goto(`/propostas/${proposalId}/editar`);
  await expect(page).toHaveURL(new RegExp(`/propostas/${proposalId}$`));

  await page.getByRole('button', { name: 'Criar link' }).click();
  const input = page.getByLabel('Link da proposta');
  await expect(input).toBeVisible();
  shareUrl = await input.inputValue();
  expect(shareUrl).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);

  const pdfHref = await page.getByRole('link', { name: 'Baixar PDF' }).getAttribute('href');
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.headers()['content-disposition']).toContain('Proposta-00001-v1.pdf');
});

test('cliente abre o link sem login, baixa o PDF e aceita; segunda decisão é barrada', async ({ browser }) => {
  const anon = await browser.newContext();
  const page = await anon.newPage();
  const violations = watchCsp(page);
  await page.goto(shareUrl);
  await expect(page.getByLabel('Proposta 00001').getByRole('cell', { name: TOTAL })).toBeVisible();
  await expect(page.getByLabel('Proposta 00001').getByText('Escopo detalhado do projeto E2E.')).toBeVisible();
  expect(await page.locator('meta[name=robots]').getAttribute('content')).toContain('noindex');
  // PDF público
  const token = shareUrl.split('/p/')[1]!;
  const pdf = await page.request.get(`/p/${token}/pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // validação do formulário
  await page.getByRole('button', { name: 'Confirmar aceite' }).click();
  await expect(page.getByText('Informe ao menos 2 caracteres.')).toBeVisible();
  await page.getByLabel('Seu nome').fill('Fulano de Tal');
  await page.getByLabel('Seu e-mail').fill('fulano@example.test');
  await page.getByRole('button', { name: 'Confirmar aceite' }).click();
  await expect(page.getByText('Marque a confirmação para continuar.')).toBeVisible();
  await page.getByLabel(/Li a proposta e confirmo/).check();
  await page.getByRole('button', { name: 'Confirmar aceite' }).click();
  await expect(page.getByText(/Proposta aceita em/)).toBeVisible(); // a página recarrega já mostrando a decisão
  await expect(page.getByRole('button', { name: 'Confirmar aceite' })).toHaveCount(0);

  // recarregar: já decidida, sem formulário
  await page.reload();
  await expect(page.getByText(/Proposta aceita em/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar aceite' })).toHaveCount(0);
  expect(violations).toEqual([]);
  await anon.close();
});

test('o responsável vê aceite, histórico e a visualização', async () => {
  const { page } = owner;
  await page.goto(`/propostas/${proposalId}`);
  await expect(page.getByText('Aceita', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Fulano de Tal \(fulano@example.test\)/)).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Histórico da proposta' });
  await expect(timeline.getByText('Aceita pelo cliente')).toBeVisible();
  await expect(timeline.getByText('Aberta pelo cliente (visualização)')).toBeVisible();
  await expect(timeline.getByText('Primeiro envio ao cliente')).toBeVisible();
  // aceita é definitiva: sem nova revisão nem cancelamento
  await expect(page.getByRole('button', { name: 'Criar nova revisão' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar proposta' })).toHaveCount(0);
});
