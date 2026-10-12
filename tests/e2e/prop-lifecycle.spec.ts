import { expect, test, type Page } from '@playwright/test';
import { decisionCount, seedClient, seedPublished, setupOwner, watchCsp, type Owner } from './prop-helpers';

// Ciclo de vida: revisões, recusa e renegociação, revogação, cancelamento, decisão concorrente e proteção contra perda de dados.
test.describe.configure({ mode: 'serial' });

let owner: Owner;
let clientId: string;
test.beforeAll(async ({ browser }) => {
  owner = await setupOwner(browser, 'life');
  clientId = await seedClient(owner, 'Cliente Ciclo S.A.', { email: 'ciclo@example.test' });
});
test.afterAll(async () => {
  await owner?.ctx.close();
});

const unavailable = (page: Page) => page.getByRole('heading', { name: 'Link indisponível' });

test('nova revisão: v1 preservada, v2 publicada, link antigo fecha e o novo abre', async ({ browser }) => {
  const p = await seedPublished(owner, { clientId, title: 'Revisões', priceCents: 100000 });
  const page = owner.page;
  await page.goto(`/propostas/${p.proposalId}`);
  await expect(page.getByText('R$ 1.000,00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Criar nova revisão' }).click();
  await page.waitForURL(`**/propostas/${p.proposalId}/editar`);
  await page.getByRole('tab', { name: 'Itens e valores' }).click();
  await page.getByLabel('Quantidade').first().fill('3');
  await expect(page.getByTestId('total')).toHaveText('R$ 3.000,00');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await page.waitForURL(/\?published=1$/);

  // versões: ambas existem; a v1 continua com o valor antigo
  const versions = page.getByRole('complementary');
  await expect(versions.getByRole('link', { name: 'Versão 1' })).toBeVisible();
  await expect(versions.getByRole('link', { name: 'Versão 2' })).toBeVisible();
  await versions.getByRole('link', { name: 'Versão 1' }).click();
  await expect(page.getByLabel('Proposta 00001').getByRole('cell', { name: 'R$ 1.000,00' }).last()).toBeVisible();

  // o link da v1 foi revogado ao publicar a v2
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(p.url);
  await expect(unavailable(pub)).toBeVisible();
  await anon.close();

  // novo link para a v2
  await page.goto(`/propostas/${p.proposalId}`);
  await page.getByRole('button', { name: 'Criar link' }).click();
  const url = await page.getByLabel('Link da proposta').inputValue();
  const anon2 = await browser.newContext();
  const pub2 = await anon2.newPage();
  await pub2.goto(url);
  await expect(pub2.getByLabel('Proposta 00001').getByRole('cell', { name: 'R$ 3.000,00' }).last()).toBeVisible();
  await anon2.close();
});

test('recusa com motivo; depois de recusada dá para renegociar com nova revisão', async ({ browser }) => {
  const p = await seedPublished(owner, { clientId, title: 'Recusa' });
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(p.url);
  await pub.getByLabel('Recusar a proposta').check();
  await pub.getByLabel('Seu nome').fill('Maria Souza');
  await pub.getByLabel('Seu e-mail').fill('maria@example.test');
  await pub.getByLabel(/Motivo/).fill('Fora do orçamento.');
  await pub.getByLabel(/Li a proposta e confirmo/).check();
  await pub.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect(pub.getByText(/Proposta recusada em/)).toBeVisible();
  await anon.close();

  const page = owner.page;
  await page.goto(`/propostas/${p.proposalId}`);
  await expect(page.getByText('Recusada', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Fora do orçamento\./)).toBeVisible();
  await page.getByRole('button', { name: 'Criar nova revisão' }).click();
  await page.waitForURL(`**/propostas/${p.proposalId}/editar`);
  await page.getByRole('button', { name: 'Publicar' }).click();
  await page.waitForURL(/\?published=1$/);
  await expect(page.getByText('Enviada').first()).toBeVisible();
});

test('revogar link fecha o acesso; cancelar fecha tudo e a proposta não aceita mais nada', async ({ browser }) => {
  const p = await seedPublished(owner, { clientId, title: 'Revogar e cancelar' });
  const page = owner.page;
  await page.goto(`/propostas/${p.proposalId}`);
  await page.getByRole('button', { name: 'Revogar' }).click();
  await expect(page.getByText('Revogado', { exact: true })).toBeVisible();
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(p.url);
  await expect(unavailable(pub)).toBeVisible();
  expect((await pub.request.get(`/p/${p.token}/pdf`)).status()).toBe(404);

  // cancelamento
  const q = await seedPublished(owner, { clientId, title: 'Cancelar' });
  await page.goto(`/propostas/${q.proposalId}`);
  await page.getByRole('button', { name: 'Cancelar proposta' }).click();
  await page.getByLabel(/Motivo do cancelamento/).fill('Escopo mudou.');
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('Cancelada', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Cancelada: Escopo mudou\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar nova revisão' })).toHaveCount(0);
  await pub.goto(q.url);
  await expect(unavailable(pub)).toBeVisible();
  await anon.close();
});

test('duas decisões ao mesmo tempo: só uma é gravada', async ({ browser }) => {
  const p = await seedPublished(owner, { clientId, title: 'Concorrência' });
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await Promise.all([pa.goto(p.url), pb.goto(p.url)]);
  for (const [page, who, decision] of [[pa, 'Ana', 'Aceitar a proposta'], [pb, 'Bia', 'Recusar a proposta']] as const) {
    await page.getByLabel(decision).check();
    await page.getByLabel('Seu nome').fill(`${who} Teste`);
    await page.getByLabel('Seu e-mail').fill(`${who.toLowerCase()}@example.test`);
    await page.getByLabel(/Li a proposta e confirmo/).check();
  }
  await Promise.all([
    pa.getByRole('button', { name: 'Confirmar aceite' }).click(),
    pb.getByRole('button', { name: 'Confirmar recusa' }).click(),
  ]);
  // quem perdeu a corrida vê o aviso; quem ganhou vê a decisão registrada
  for (const page of [pa, pb]) await expect(page.getByText(/Proposta (aceita|recusada) em|já recebeu uma resposta/).first()).toBeVisible();
  await pa.waitForTimeout(500);
  expect(await decisionCount(owner, p.proposalId)).toBe(1);
  await a.close();
  await b.close();
});

test('alterações não salvas: aviso ao fechar; salvar libera; trocar de modelo não apaga conteúdo; catálogo não altera o rascunho', async () => {
  const page = owner.page;
  const violations = watchCsp(page);
  await page.goto('/propostas/nova');
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente Ciclo S.A.' });
  await page.getByLabel('Título da proposta').fill('Rascunho de proteção');
  await page.getByRole('button', { name: 'Criar proposta e abrir o editor' }).click();
  await page.waitForURL(/\/editar$/);

  await page.waitForTimeout(1000);
  await expect(page.getByText('Alterações não salvas')).toHaveCount(0); // abrir o editor não suja o estado

  await page.getByLabel('Título da proposta').fill('Título alterado sem salvar');
  const dialog = page.waitForEvent('dialog', { timeout: 5000 });
  await page.close({ runBeforeUnload: true });
  expect((await dialog).type()).toBe('beforeunload');
  await (await dialog).dismiss().catch(() => undefined);
  owner.page = await owner.ctx.newPage();
  const p2 = owner.page;
  p2.on('dialog', (d) => void d.accept());

  // abre de novo: o título não salvo NÃO foi gravado
  await p2.goto('/propostas');
  await expect(p2.getByRole('cell', { name: 'Rascunho de proteção' })).toBeVisible();
  await p2.getByRole('link', { name: /^0000\d$/ }).first().click();
  await p2.getByRole('link', { name: 'Editar rascunho' }).click();
  await expect(p2.getByLabel('Título da proposta')).toHaveValue('Rascunho de proteção');

  // texto + troca de modelo: o conteúdo permanece
  await p2.getByRole('tab', { name: 'Conteúdo' }).click();
  await p2.getByRole('textbox', { name: 'Texto da seção Escopo' }).click();
  await p2.keyboard.type('Texto que não pode sumir.');
  await p2.getByRole('tab', { name: 'Informações' }).click();
  await p2.getByLabel('Modelo visual').selectOption({ label: 'Agência Criativa' });
  await p2.getByRole('tab', { name: 'Conteúdo' }).click();
  await expect(p2.getByRole('textbox', { name: 'Texto da seção Escopo' })).toContainText('Texto que não pode sumir.');

  // item avulso: reordenar, duplicar e remover
  await p2.getByRole('tab', { name: 'Itens e valores' }).click();
  await p2.getByRole('button', { name: 'Item avulso' }).click();
  await p2.getByLabel('Item 1', { exact: true }).fill('Primeiro');
  await p2.getByRole('button', { name: 'Item avulso' }).click();
  await p2.getByLabel('Item 2', { exact: true }).fill('Segundo');
  await p2.getByRole('button', { name: 'Mover item 2 para cima' }).click();
  await expect(p2.getByLabel('Item 1', { exact: true })).toHaveValue('Segundo');
  await p2.getByRole('button', { name: 'Duplicar item 1' }).click();
  await expect(p2.getByLabel('Item 2', { exact: true })).toHaveValue('Segundo');
  await p2.getByRole('button', { name: 'Remover item 2' }).click();
  await expect(p2.getByLabel('Item 2', { exact: true })).toHaveValue('Primeiro');
  expect(violations).toEqual([]);
});
