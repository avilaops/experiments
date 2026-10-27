import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createApiServer } from "../../dist/lab/server.js";
import { createDashboard } from "../dist/server.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-review-ui-"));
  const token = "ephemeral-ui-test-token";
  const api = await createApiServer({ dataDirectory: directory, token });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = "http://127.0.0.1:" + api.address().port;
  const options = {
    apiUrl, apiToken: token, username: "tester", password: "ephemeral-ui-test-password",
    origin: "http://localhost", assetDirectory: fileURLToPath(new URL("../dist/", import.meta.url)),
  };
  const bff = createDashboard(options);
  await new Promise(resolve => bff.listen(0, "127.0.0.1", resolve));
  options.origin = "http://127.0.0.1:" + bff.address().port;
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    await new Promise(resolve => bff.close(resolve));
    await new Promise(resolve => api.close(resolve));
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-review-ui-"));
    await rm(directory, { recursive: true, force: true });
  });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    httpCredentials: { username: options.username, password: options.password },
    viewport: { width: 390, height: 844 },
  });
  const errors = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  const page = await context.newPage();
  t.after(() => assert.deepEqual(errors, []));
  const data = async route => (await fetch(apiUrl + route, { headers: { Authorization: "Bearer " + token } })).json();
  return { page, base: options.origin, data };
}

async function holdSave(page, routePattern) {
  let release, observed;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { observed = resolve; });
  await page.route(routePattern, async route => {
    if (route.request().method() === "PUT") { observed(); await gate; }
    await route.continue();
  });
  return {
    started: () => Promise.race([started, new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error("Save request was not sent")), 10000);
      timeout.unref();
      started.finally(() => clearTimeout(timeout));
    })]),
    release,
  };
}

test("new policy rejects duplicate IDs without locking the code or replacing the existing record", async t => {
  const { page, base, data } = await fixture(t);
  const original = await data("/api/v1/policies");
  await page.goto(base + "/experiments/policies");
  await page.getByRole("button", { name: "Nova política", exact: true }).click();
  const code = page.getByLabel("Código da política");
  await code.fill("ERP-ACCESS-001");
  assert.equal(await code.isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Salvar política", exact: true }).isDisabled(), true);
  await page.getByRole("alert").filter({ hasText: "Este código já existe" }).waitFor();
  // A submit event must also be guarded, rather than relying on a disabled button.
  await page.locator(".policy-editor form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  assert.deepEqual(await data("/api/v1/policies"), original);
  await code.fill("ERP-REVIEW-003");
  await page.getByLabel("Título da política").fill("Política de teste");
  await page.getByLabel("O que a regra exige").fill("Regra para validar a criação explícita.");
  await page.getByLabel("Motivo da alteração").fill("Teste de regressão");
  await page.getByRole("button", { name: "Salvar política", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  const saved = await data("/api/v1/policies");
  assert.equal(saved.policies.length, original.policies.length + 1);
  assert.deepEqual(saved.policies.find(item => item.id === "ERP-ACCESS-001"), original.policies.find(item => item.id === "ERP-ACCESS-001"));
  await page.getByRole("button", { name: "Editar política", exact: true }).click();
  assert.equal(await code.isDisabled(), true);
  assert.equal(await page.getByLabel("Produto da política").isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

async function openPolicy(page, base, id = "ERP-ACCESS-001") {
  await page.goto(base + "/experiments/policies");
  await page.locator(".policy-card").filter({ hasText: id }).click();
  await page.getByRole("button", { name: "Editar política", exact: true }).click();
}

async function savePolicy(page, note) {
  await page.getByLabel("Motivo da alteração").fill(note);
  await page.getByRole("button", { name: "Salvar política", exact: true }).click();
}

test("two tabs reconcile overlapping fields explicitly while preserving independent edits and the change note", async t => {
  const { page: first, base, data } = await fixture(t);
  const second = await first.context().newPage();
  await openPolicy(first, base);
  await openPolicy(second, base);
  await first.getByLabel("Título da política").fill("Título da primeira tela");
  await first.getByLabel("Responsável", { exact: true }).fill("Equipe atual");
  await savePolicy(first, "Primeira tela");
  await first.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  await second.getByLabel("Título da política").fill("Título da segunda tela");
  await second.getByLabel("O que a regra exige").fill("Regra da segunda tela");
  await savePolicy(second, "Motivo preservado");
  await second.getByRole("button", { name: "Conferir versão atual", exact: true }).click();
  const field = second.getByRole("group", { name: "Conflito: Título", exact: true });
  await field.waitFor();
  assert.match(await field.innerText(), /Título da primeira tela/);
  assert.match(await field.innerText(), /Título da segunda tela/);
  assert.equal(await second.getByLabel("Responsável", { exact: true }).inputValue(), "Equipe atual");
  assert.equal(await second.getByLabel("O que a regra exige").inputValue(), "Regra da segunda tela");
  assert.equal(await second.getByLabel("Motivo da alteração").inputValue(), "Motivo preservado");
  assert.equal(await second.getByRole("button", { name: "Salvar política", exact: true }).isDisabled(), true);
  await second.locator(".policy-editor form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  assert.equal((await data("/api/v1/policies")).revision, 2);
  assert.equal(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await field.getByRole("button", { name: "Manter minha edição", exact: true }).click();
  await second.getByRole("button", { name: "Salvar política", exact: true }).click();
  await second.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  const catalog = await data("/api/v1/policies");
  const saved = catalog.policies.find(item => item.id === "ERP-ACCESS-001");
  assert.equal(saved.title, "Título da segunda tela");
  assert.equal(saved.owner, "Equipe atual");
  assert.equal(saved.rule, "Regra da segunda tela");
  assert.equal(saved.version, 3);
  assert.equal(catalog.history.at(-1).changeNote, "Motivo preservado");
});

test("accepting the current value still requires a new review if another edit arrives before saving", async t => {
  const { page: first, base, data } = await fixture(t);
  const second = await first.context().newPage();
  await openPolicy(first, base);
  await openPolicy(second, base);
  await first.getByLabel("O que a regra exige").fill("Regra atual");
  await savePolicy(first, "Atualização da regra");
  await first.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  await second.getByLabel("O que a regra exige").fill("Regra local");
  await second.getByLabel("Título da política").fill("Título independente");
  await savePolicy(second, "Conferência concorrente");
  await second.getByRole("button", { name: "Conferir versão atual", exact: true }).click();
  await second.getByRole("group", { name: "Conflito: Regra", exact: true }).getByRole("button", { name: "Usar versão atual", exact: true }).click();
  assert.equal(await second.getByLabel("O que a regra exige").inputValue(), "Regra atual");
  await openPolicy(first, base);
  await first.getByLabel("Responsável", { exact: true }).fill("Equipe mais recente");
  await savePolicy(first, "Nova alteração durante a conferência");
  await first.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  await second.getByRole("button", { name: "Salvar política", exact: true }).click();
  await second.getByRole("button", { name: "Conferir versão atual", exact: true }).click();
  await second.getByRole("status").filter({ hasText: "Alterações em campos diferentes foram reunidas" }).waitFor();
  assert.equal(await second.getByLabel("Responsável", { exact: true }).inputValue(), "Equipe mais recente");
  await second.getByRole("button", { name: "Salvar política", exact: true }).click();
  await second.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  const saved = (await data("/api/v1/policies")).policies.find(item => item.id === "ERP-ACCESS-001");
  assert.equal(saved.title, "Título independente");
  assert.equal(saved.rule, "Regra atual");
  assert.equal(saved.owner, "Equipe mais recente");
  assert.equal(saved.version, 4);
});

test("a catalog conflict caused by a different policy preserves both independent updates", async t => {
  const { page: first, base, data } = await fixture(t);
  const second = await first.context().newPage();
  await openPolicy(first, base, "ERP-ACCESS-001");
  await openPolicy(second, base, "ERP-ACCESS-002");
  await first.getByLabel("Título da política").fill("Primeira ficha atualizada");
  await savePolicy(first, "Atualizar primeira ficha");
  await first.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  await second.getByLabel("Título da política").fill("Segunda ficha atualizada");
  await savePolicy(second, "Atualizar segunda ficha");
  await second.getByRole("button", { name: "Conferir versão atual", exact: true }).click();
  await second.getByRole("status").filter({ hasText: "Alterações em campos diferentes foram reunidas" }).waitFor();
  await second.getByRole("button", { name: "Salvar política", exact: true }).click();
  await second.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  const catalog = await data("/api/v1/policies");
  assert.equal(catalog.policies.find(item => item.id === "ERP-ACCESS-001").title, "Primeira ficha atualizada");
  assert.equal(catalog.policies.find(item => item.id === "ERP-ACCESS-002").title, "Segunda ficha atualizada");
});

test("print media and A4 PDF include the saved policy and sources without editor, history or navigation", async t => {
  const { page, base, data } = await fixture(t);
  const original = (await data("/api/v1/policies")).policies.find(item => item.id === "ERP-ACCESS-001");
  await page.goto(base + "/experiments/policies");
  await page.locator(".policy-card").filter({ hasText: original.id }).click();
  await page.getByRole("button", { name: "Editar política", exact: true }).click();
  await page.getByLabel("Título da política").fill("Rascunho não salvo");
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: "print" });
  for (const selector of ["header", ".policy-controls", ".policy-editor", ".policy-list", ".policy-history", "footer"]) {
    assert.equal(await page.locator(selector).isVisible(), false);
  }
  assert.equal(await page.locator(".policy-paper h2").innerText(), original.title);
  assert.equal(await page.locator(".policy-print-note").isVisible(), true);
  assert.match(await page.locator(".policy-paper").innerText(), /Cadastro privado e manual/);
  assert.match(await page.locator(".policy-paper").innerText(), /versão 1/);
  assert.equal(await page.locator(".policy-source").first().isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 5000);
});

test("suite controls stay locked until saving finishes and the UI agrees with persistence", async t => {
  const { page, base, data } = await fixture(t);
  await page.goto(base + "/experiments/");
  await page.getByLabel("Hipótese", { exact: true }).fill("Hipótese enviada");
  const save = await holdSave(page, "**/experiments/api/v1/suite");
  await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
  await save.started();
  try {
    const controls = await page.locator("form input, form textarea, form select").all();
    assert.equal(controls.length, 9);
    for (const control of controls) assert.equal(await control.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Executar suíte salva", exact: true }).isDisabled(), true);
  } finally { save.release(); }
  await page.getByRole("status").filter({ hasText: "salva." }).waitFor();
  assert.equal(await page.getByLabel("Hipótese", { exact: true }).isEnabled(), true);
  assert.equal(await page.getByLabel("Hipótese", { exact: true }).inputValue(), (await data("/api/v1/suite")).hypothesis);
});

test("policy fields stay locked during saves, and existing records can be deliberately revised", async t => {
  const { page, base, data } = await fixture(t);
  await page.goto(base + "/experiments/policies");
  await page.locator(".policy-card").filter({ hasText: "ERP-ACCESS-001" }).click();
  await page.getByRole("button", { name: "Editar política", exact: true }).click();
  await page.getByLabel("Título da política").fill("Título revisado");
  await page.getByLabel("Motivo da alteração").fill("Revisão explícita");
  const save = await holdSave(page, "**/experiments/api/v1/policies");
  await page.getByRole("button", { name: "Salvar política", exact: true }).click();
  await save.started();
  try {
    assert.equal(await page.getByLabel("Título da política").isDisabled(), true);
    assert.equal(await page.getByLabel("O que a regra exige").isDisabled(), true);
  } finally { save.release(); }
  await page.getByRole("status").filter({ hasText: "Política salva" }).waitFor();
  const saved = (await data("/api/v1/policies")).policies.find(item => item.id === "ERP-ACCESS-001");
  assert.equal(saved.title, "Título revisado");
  assert.equal(saved.version, 2);
});
