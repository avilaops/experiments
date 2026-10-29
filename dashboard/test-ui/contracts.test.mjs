import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createApiServer } from "../../dist/lab/server.js";
import { createDashboard } from "../dist/server.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-contract-ui-"));
  let api, bff, browser;
  const errors = [];
  t.after(async () => {
    if (browser) await browser.close();
    for (const server of [bff, api]) if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith("avila-contract-ui-"));
    await rm(directory, { recursive: true, force: true }); assert.deepEqual(errors, []);
  });
  const token = "ephemeral-contract-ui-token";
  api = await createApiServer({ dataDirectory: directory, token });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = "http://127.0.0.1:" + api.address().port;
  bff = createDashboard({ apiUrl, apiToken: token, username: "tester", password: "ephemeral-contract-ui-password", assetDirectory: fileURLToPath(new URL("../dist/", import.meta.url)) });
  await new Promise(resolve => bff.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + bff.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ httpCredentials: { username: "tester", password: "ephemeral-contract-ui-password" }, viewport: { width: 390, height: 844 } });
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  const page = await context.newPage();
  const catalog = async () => (await fetch(apiUrl + "/api/v1/client-contracts", { headers: { Authorization: "Bearer " + token } })).json();
  return { page, base, catalog };
}
async function fill(page, code = "LAB-UI-001") {
  await page.getByLabel("Código do contrato", { exact: true }).fill(code);
  await page.getByLabel("Título do contrato", { exact: true }).fill("Serviço de teste");
  await page.getByLabel("Nome do cliente", { exact: true }).fill("Cliente sintético");
  await page.getByLabel("Referência externa do cliente").fill("CRM-TEST-1");
  await page.getByLabel("Início da vigência").fill("2026-10-28");
  await page.getByLabel("Término da vigência").fill("2027-10-28");
  await page.getByLabel("Valor em reais", { exact: true }).fill("1234,56");
  await page.getByLabel("Motivo da alteração").fill("Criação para teste");
}
async function save(page, version) {
  await page.getByRole("button", { name: "Salvar contrato", exact: true }).click();
  await page.getByRole("status").filter({ hasText: `Contrato salvo. Versão ${version}.` }).waitFor();
}

test("mobile contracts create, block concurrent form changes, edit, filter and show persistent snapshots", async t => {
  const { page, base, catalog } = await fixture(t);
  await page.goto(base + "/experiments/contracts");
  await page.getByText("Nenhum contrato cadastrado. Use Novo contrato para iniciar.").waitFor();
  await page.getByRole("button", { name: "Novo contrato", exact: true }).click(); await fill(page);
  let release, observed;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { observed = resolve; });
  t.after(() => release());
  await page.route("**/api/v1/client-contracts", async route => { if (route.request().method() === "PUT") { observed(); await gate; } await route.continue(); });
  await page.getByRole("button", { name: "Salvar contrato", exact: true }).click();
  await started;
  assert.equal(await page.getByLabel("Nome do cliente", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Novo contrato", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Cancelar edição e recarregar" }).isDisabled(), true);
  release(); await page.getByRole("status").filter({ hasText: "Contrato salvo. Versão 1." }).waitFor();
  await page.unroute("**/api/v1/client-contracts");
  assert.equal((await catalog()).contracts[0].amount, "1234.56");
  await page.getByRole("button", { name: "Novo contrato", exact: true }).click(); await fill(page);
  await page.getByRole("alert").filter({ hasText: "Este código já pertence" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Salvar contrato", exact: true }).isDisabled(), true);
  await page.locator(".contract-editor form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  assert.equal((await catalog()).revision, 1);
  await page.getByRole("button", { name: "Cancelar edição e recarregar" }).click();
  await page.getByRole("button", { name: "Editar contrato", exact: true }).click();
  await page.getByLabel("Título do contrato", { exact: true }).fill("Serviço atualizado");
  await page.getByLabel("Situação do contrato").selectOption("active");
  await page.getByLabel("Motivo da alteração").fill("Ativar contrato de teste"); await save(page, 2);
  await page.reload(); await page.getByRole("button", { name: "Abrir contrato LAB-UI-001", exact: true }).click();
  await page.locator("details summary").filter({ hasText: "Versão 1" }).click();
  await page.getByText("Motivo: Criação para teste", { exact: true }).waitFor();
  assert.equal((await catalog()).contracts[0].version, 2);
  await page.getByLabel("Buscar contratos").fill("inexistente"); await page.getByText("Nenhum contrato corresponde aos filtros.").waitFor();
  await page.getByLabel("Buscar contratos").fill("cliente sintético");
  await page.getByRole("button", { name: "Abrir contrato LAB-UI-001", exact: true }).waitFor();
  await page.getByLabel("Filtrar situação").selectOption("cancelled"); await page.getByText("Nenhum contrato corresponde aos filtros.").waitFor();
  await page.getByLabel("Filtrar situação").selectOption("active");
  await page.getByLabel("Filtrar produto").selectOption("lojas"); await page.getByText("Nenhum contrato corresponde aos filtros.").waitFor();
  await page.getByLabel("Filtrar produto").selectOption("erp");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir(new URL("../../reports/contracts-ui/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../../reports/contracts-ui/mobile.png", import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("a stale contract edit keeps its fields and reason until explicit cancellation and reload", async t => {
  const { page: first, base, catalog } = await fixture(t);
  await first.goto(base + "/experiments/contracts");
  await first.getByRole("button", { name: "Novo contrato", exact: true }).click(); await fill(first); await save(first, 1);
  const second = await first.context().newPage(); await second.goto(base + "/experiments/contracts");
  await second.getByRole("button", { name: "Abrir contrato LAB-UI-001", exact: true }).click();
  for (const page of [first, second]) await page.getByRole("button", { name: "Editar contrato", exact: true }).click();
  await first.getByLabel("Título do contrato", { exact: true }).fill("Título da primeira tela");
  await first.getByLabel("Motivo da alteração").fill("Primeira atualização"); await save(first, 2);
  await second.getByLabel("Título do contrato", { exact: true }).fill("Edição local preservada");
  await second.getByLabel("Motivo da alteração").fill("Motivo local preservado");
  await second.getByRole("button", { name: "Salvar contrato", exact: true }).click();
  await second.getByRole("alert").filter({ hasText: "Outro contrato foi salvo" }).waitFor();
  assert.equal(await second.getByLabel("Título do contrato", { exact: true }).inputValue(), "Edição local preservada");
  assert.equal(await second.getByLabel("Motivo da alteração").inputValue(), "Motivo local preservado");
  assert.equal(await second.getByRole("button", { name: "Salvar contrato", exact: true }).isDisabled(), true);
  assert.equal((await catalog()).contracts[0].title, "Título da primeira tela");
  await second.getByRole("button", { name: "Cancelar edição e recarregar" }).click();
  await second.getByRole("button", { name: "Editar contrato", exact: true }).click();
  assert.equal(await second.getByLabel("Título do contrato", { exact: true }).inputValue(), "Título da primeira tela");
  await second.getByLabel("Motivo da alteração").fill("Conferência da versão atual"); await save(second, 3);
  assert.equal((await catalog()).revision, 3);
});
