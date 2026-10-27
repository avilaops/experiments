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
  browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "chrome" } : {}) });
  const context = await browser.newContext({
    httpCredentials: { username: options.username, password: options.password },
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
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
