import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiLogin, apiSignUp, uiLogin, uniqueEmail } from './helpers';
import { addMember, newToken, rpc, seedClient, seedPublished, setupOwner, watchCsp, type Owner, type Published } from './prop-helpers';

// Segurança e permissões: isolamento entre organizações, papéis, link público sem enumeração,
// logotipo seguro, CSV sem injeção de fórmula, XSS e cabeçalhos.
test.describe.configure({ mode: 'serial' });

let a: Owner;
let b: Owner;
let seller: { email: string; id: string; token: string };
let viewer: { email: string; id: string };
let clientA: string;
let pOwner: Published;
let pSeller: Published;

async function memberLogin(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await uiLogin(page, email);
  await page.waitForURL('**/dashboard');
  return page;
}

test.beforeAll(async ({ browser }) => {
  a = await setupOwner(browser, 'secA');
  b = await setupOwner(browser, 'secB');
  clientA = await seedClient(a, 'Cliente da empresa A');
  const sellerEmail = uniqueEmail('vend');
  const viewerEmail = uniqueEmail('leit');
  const s = await apiSignUp(sellerEmail);
  const v = await apiSignUp(viewerEmail);
  await addMember(a, s.id, 'member');
  await addMember(a, v.id, 'viewer');
  seller = { email: sellerEmail, id: s.id, token: await apiLogin(sellerEmail) };
  viewer = { email: viewerEmail, id: v.id };
  pOwner = await seedPublished(a, { clientId: clientA, title: 'Proposta do dono A', priceCents: 123400 });
  // proposta do vendedor (criada por ele, via API com o token dele)
  const id = await rpc<string>(seller.token, 'prop_create_proposal', { p_client: clientA, p_title: 'Proposta do vendedor' });
  const revisions = (await (await fetch(`${process.env.E2E_SUPABASE_URL}/rest/v1/proposals?id=eq.${id}&select=current_revision_id`, { headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY!, authorization: `Bearer ${seller.token}` } })).json()) as Array<{ current_revision_id: string }>;
  pSeller = { proposalId: id, revisionId: revisions[0]!.current_revision_id, token: '', url: '' };
});
test.afterAll(async () => {
  await a?.ctx.close();
  await b?.ctx.close();
});

test('sem login: páginas e arquivos protegidos redirecionam para o login', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const path of ['/propostas', '/clientes', '/dashboard', '/catalogo', '/relatorios', `/propostas/${pOwner.proposalId}`]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  // o proxy redireciona antes de chegar à rota; sem seguir o redirecionamento, nada de arquivo
  for (const path of ['/export/clients', '/export/proposals', `/propostas/${pOwner.proposalId}/pdf`]) {
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBeGreaterThanOrEqual(300);
    expect(res.status(), path).toBeLessThan(400);
    expect(res.headers().location, path).toContain('/login');
    expect(res.headers()['content-type'] ?? '', path).not.toMatch(/csv|pdf/);
  }
  await ctx.close();
});

test('link público: inexistente, mal formado e revogado respondem IGUAL (sem enumeração) e a página não é indexável', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bodies: string[] = [];
  const revoked = await seedPublished(a, { clientId: clientA, title: 'Será revogada' });
  const links = (await (await fetch(`${process.env.E2E_SUPABASE_URL}/rest/v1/proposal_share_links?proposal_id=eq.${revoked.proposalId}&select=id`, { headers: { apikey: process.env.E2E_SUPABASE_ANON_KEY!, authorization: `Bearer ${a.token}` } })).json()) as Array<{ id: string }>;
  await rpc(a.token, 'prop_revoke_share_link', { p_link: links[0]!.id });
  for (const token of [newToken().token, 'curto', 'x'.repeat(43), '../../etc/passwd', revoked.token]) {
    const res = await page.goto(`/p/${encodeURIComponent(token)}`);
    expect(res!.status(), token).toBeLessThan(500);
    await expect(page.getByRole('heading', { name: 'Link indisponível' })).toBeVisible();
    bodies.push(await page.getByRole('main').innerText());
    expect((await page.request.get(`/p/${encodeURIComponent(token)}/pdf`)).status()).toBe(404);
  }
  expect(new Set(bodies).size).toBe(1);

  const ok = await page.goto(pOwner.url);
  expect(ok!.status()).toBe(200);
  const h = ok!.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toMatch(/nonce-/);
  expect(h['x-frame-options']).toBe('DENY');
  expect(await page.locator('meta[name=robots]').getAttribute('content')).toMatch(/noindex/);
  expect(await page.locator('meta[name=referrer]').getAttribute('content')).toBe('no-referrer');
  await ctx.close();
});

test('outra organização não enxerga nada desta (páginas, PDF e exportação)', async () => {
  const page = b.page;
  for (const path of [`/propostas/${pOwner.proposalId}`, `/propostas/${pOwner.proposalId}/editar`, `/clientes/${clientA}`]) {
    const res = await page.goto(path);
    expect(res!.status(), path).toBe(404);
  }
  expect((await page.request.get(`/propostas/${pOwner.proposalId}/pdf`)).status()).toBe(404);
  await page.goto('/propostas');
  await expect(page.getByText('Proposta do dono A')).toHaveCount(0);
  const csv = await (await page.request.get('/export/proposals')).text();
  expect(csv).not.toContain('Proposta do dono A');
  expect(await (await page.request.get('/export/clients')).text()).not.toContain('Cliente da empresa A');
  // chamadas diretas ao banco também são negadas
  await expect(rpc(b.token, 'prop_save_draft', { p_revision: pOwner.revisionId, p_payload: { title: 'Invasão' } })).rejects.toThrow();
  await expect(rpc(b.token, 'prop_cancel', { p_proposal: pOwner.proposalId, p_reason: 'x' })).rejects.toThrow();
});

test('vendedor só vê e abre as próprias propostas e não administra', async ({ browser }) => {
  const page = await memberLogin(browser, seller.email);
  await page.goto('/propostas');
  await expect(page.getByRole('link', { name: /^0000\d$/ })).toHaveCount(1);
  await expect(page.getByText('Proposta do vendedor')).toBeVisible();
  await expect(page.getByText('Proposta do dono A')).toHaveCount(0);
  await expect(page.getByLabel('Responsável')).toHaveCount(0); // filtro de gestão
  expect((await page.goto(`/propostas/${pSeller.proposalId}`))!.status()).toBe(200); // a própria abre
  expect((await page.goto(`/propostas/${pOwner.proposalId}`))!.status()).toBe(404);
  expect((await page.goto('/configuracoes'))!.status()).toBe(404);
  await page.goto('/catalogo');
  await expect(page.getByText('Novo item', { exact: true })).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page.getByText('Você vê os números das suas próprias propostas.')).toBeVisible();
  // exportação respeita o papel
  const csv = await (await page.request.get('/export/proposals')).text();
  expect(csv).toContain('Proposta do vendedor');
  expect(csv).not.toContain('Proposta do dono A');
  // API direta: não publica a do dono nem cria em nome de outro
  await expect(rpc(seller.token, 'prop_publish_revision', { p_revision: pOwner.revisionId })).rejects.toThrow();
  await expect(rpc(seller.token, 'prop_create_proposal', { p_client: clientA, p_title: 'Em nome de outro', p_owner: a.userId })).rejects.toThrow();
  await page.context().close();
});

test('leitor lê tudo e não escreve', async ({ browser }) => {
  const page = await memberLogin(browser, viewer.email);
  await page.goto('/propostas');
  await expect(page.getByText('Proposta do dono A')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nova proposta' })).toHaveCount(0);
  expect((await page.goto('/propostas/nova'))!.status()).toBe(404);
  expect((await page.goto('/clientes/novo'))!.status()).toBe(404);
  await page.goto(`/propostas/${pOwner.proposalId}`);
  await expect(page.getByText('R$ 1.234,00').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Criar link' })).toHaveCount(0);
  expect((await page.request.get(`/propostas/${pOwner.proposalId}/pdf`)).status()).toBe(200); // pode baixar
  await page.context().close();
});

test('logotipo: só PNG/JPEG conferidos pelos bytes, com limite de tamanho; o do documento é o da época da publicação', async () => {
  const page = a.page;
  await page.goto('/configuracoes');
  const pick = page.getByLabel('Enviar logotipo');
  // espera a resposta da Server Action antes de seguir (evita corrida entre envios)
  const send = async () => {
    const done = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/configuracoes'));
    await page.locator('button[type=submit]', { hasText: 'Enviar logotipo' }).click();
    await done;
  };
  await pick.setInputFiles({ name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('isto não é uma imagem') });
  await send();
  await expect(page.getByText('Formato não permitido: use PNG ou JPEG.')).toBeVisible();
  await pick.setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await send();
  await expect(page.getByText('Formato não permitido: use PNG ou JPEG.')).toBeVisible();
  await pick.setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(350_000)]) });
  await send();
  await expect(page.getByText('Imagem muito grande (máximo de 300 KB).')).toBeVisible();

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await pick.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await send();
  await expect(page.getByText('Logotipo atualizado.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Logotipo atual' })).toBeVisible();

  // publica DEPOIS do logotipo: o snapshot leva a imagem; remover o logotipo depois não muda a publicada
  const withLogo = await seedPublished(a, { clientId: clientA, title: 'Com logotipo' });
  await page.getByRole('button', { name: 'Remover logotipo' }).click();
  await expect(page.getByRole('img', { name: 'Logotipo atual' })).toHaveCount(0);
  const pdf = await page.request.get(`/p/${withLogo.token}/pdf`);
  expect((await pdf.body()).toString('latin1')).toContain('/Subtype /Image');
});

test('CSV: fórmulas são neutralizadas; importação valida antes de gravar e recusa documento repetido', async () => {
  const page = a.page;
  await seedClient(a, '=HYPERLINK("http://evil.invalid","x")', { email: 'evil@example.test' });
  const csv = await (await page.request.get('/export/clients')).text();
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain(`"'=HYPERLINK(""http://evil.invalid"",""x"")"`);
  expect(csv).not.toMatch(/(^|;)"?=HYPERLINK/m);

  await page.goto('/clientes/importar');
  const file = (rows: string) => ({ name: 'clientes.csv', mimeType: 'text/csv', buffer: Buffer.from(`﻿nome;cpf/cnpj;e-mail;telefone;tipo\r\n${rows}`) });
  const rows = ['Importada Um Ltda;11.444.777/0001-61;um@example.test;(11) 99999-0001;empresa', 'Importada Dois;529.982.247-25;dois@example.test;;pessoa física', 'Documento ruim;123;x@example.test;;empresa', 'Importada Um Repetida;11444777000161;r@example.test;;empresa', 'A;;;;'].join('\r\n');
  await page.getByLabel('Arquivo CSV').setInputFiles(file(rows));
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText(/Validação concluída: 2 pronto\(s\) para importar, 1 duplicado\(s\), 2 com erro\. Nada foi gravado\./)).toBeVisible();
  await expect(page.getByText('Linha 4: CPF ou CNPJ inválido.')).toBeVisible();
  await page.goto('/clientes?q=Importada');
  await expect(page.getByText('Nenhum cliente')).toBeVisible(); // nada gravado na validação
  await page.goto('/clientes/importar');
  await page.getByLabel('Arquivo CSV').setInputFiles(file(rows));
  await page.getByLabel(/Apenas validar/).uncheck();
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('2 cliente(s) importado(s).')).toBeVisible();
  await page.goto('/clientes?q=Importada');
  await expect(page.getByRole('link', { name: 'Importada Um Ltda' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Importada Dois' })).toBeVisible();
  // arquivo grande é recusado
  await page.goto('/clientes/importar');
  await page.getByLabel('Arquivo CSV').setInputFiles({ name: 'grande.csv', mimeType: 'text/csv', buffer: Buffer.alloc(1_100_000, 'a') });
  await expect(page.getByText('Arquivo muito grande (máximo de 1 MB).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeDisabled();
});

test('XSS: HTML em nomes e textos é exibido como texto e links perigosos não funcionam', async ({ browser }) => {
  const page = a.page;
  const violations = watchCsp(page);
  const evil = '<img src=x onerror="window.__xss=1">';
  const cid = await seedClient(a, evil);
  await page.goto('/clientes');
  await expect(page.getByText(evil, { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // texto com HTML no escopo, publicado e aberto no link público
  const p = await seedPublished(a, { clientId: cid, title: 'XSS <script>window.__xss=2</script>' });
  const revision = await rpc<{ revision_id: string }>(a.token, 'prop_create_revision', { p_proposal: p.proposalId }).catch(() => null);
  void revision;
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  const v2 = watchCsp(pub);
  await pub.goto(p.url);
  await expect(pub.getByText('<script>window.__xss=2</script>', { exact: false }).first()).toBeVisible();
  await expect(pub.getByText(evil, { exact: false }).first()).toBeVisible();
  expect(await pub.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(v2).toEqual([]);
  await anon.close();

  // editor: link javascript: é recusado
  const q = await rpc<string>(a.token, 'prop_create_proposal', { p_client: cid, p_title: 'Link perigoso' });
  await page.goto(`/propostas/${q}/editar`);
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  const ed = page.getByRole('textbox', { name: 'Texto da seção Escopo' });
  await ed.click();
  await page.keyboard.type('clique aqui');
  await page.keyboard.press('Control+A');
  const scope = page.locator('.rich-editor').filter({ has: ed }); // cada seção tem a sua barra de ferramentas
  await scope.getByRole('button', { name: 'Link', exact: true }).click();
  await scope.getByLabel('Endereço do link').fill('javascript:alert(1)');
  await scope.getByRole('button', { name: 'Aplicar link' }).click();
  await expect(page.getByText('Use um endereço http, https ou mailto.')).toBeVisible();
  expect(violations).toEqual([]);
});
