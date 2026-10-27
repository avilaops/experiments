import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createApiServer } from "../dist/lab/server.js";
import { createDashboard } from "../dashboard/dist/server.mjs";
import { chromium } from "../dashboard/node_modules/playwright/index.mjs";
const root = new URL("../", import.meta.url);
const token = randomUUID();
const seed = JSON.parse(await readFile(new URL("examples/suites/calculation.cases.json", root)));
const defaults = (await import("../dist/lab/contracts.js")).DEFAULT_DRAFT;
const api = await createApiServer({ dataDirectory: fileURLToPath(new URL("var/ui-check-" + randomUUID(), root)), token, seed: { ...defaults, cases: seed.cases } });
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const apiUrl = "http://127.0.0.1:" + api.address().port;
const bff = createDashboard({ apiUrl, apiToken: token, username: "tester", password: "local-verification-only-2026", origin: "http://localhost", assetDirectory: fileURLToPath(new URL("dashboard/dist/", root)) });
await new Promise(resolve => bff.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + bff.address().port;
// BFF mutations without Origin simulate agents; browser Origin must match its real URL.
await new Promise(resolve => bff.close(resolve));
const dashboard = createDashboard({ apiUrl, apiToken: token, username: "tester", password: "local-verification-only-2026", origin: base, assetDirectory: fileURLToPath(new URL("dashboard/dist/", root)) });
await new Promise(resolve => dashboard.listen(Number(new URL(base).port), "127.0.0.1", resolve));
const directory = fileURLToPath(new URL("evidencias/screenshots/", root));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ httpCredentials: { username: "tester", password: "local-verification-only-2026" }, viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(base + "/experiments/");
  await page.getByLabel("Casos da suíte (JSON)").waitFor();
  assert.equal(JSON.parse(await page.getByLabel("Casos da suíte (JSON)").inputValue()).length, 14);
  await page.getByRole("button", { name: "Executar suíte salva" }).click();
  await page.getByRole("status").filter({ hasText: "Execução registrada" }).waitFor();
  await page.screenshot({ path: directory + "/local-desktop.png", fullPage: true });
  await page.getByLabel("Variante", { exact: true }).selectOption("baseline");
  await page.locator("details").first().locator("summary").click();
  assert.ok((await page.locator("details").first().innerText()).includes("Output exceeds"));
  const adversarial = [
    { id: "wrong-reference", input: { operation: "add", left: 1, right: 1 }, expected: 99 },
    { id: "no-reference", input: { operation: "add", left: 1, right: 1 } },
    { id: "division-zero", input: { operation: "divide", left: 1, right: 0 }, expected: 0 },
  ];
  await page.getByLabel("Casos da suíte (JSON)").fill(JSON.stringify(adversarial, null, 2));
  await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "salva." }).waitFor();
  await page.getByRole("button", { name: "Executar suíte salva" }).click();
  await page.getByRole("status").filter({ hasText: "Execução registrada" }).waitFor();
  await page.getByLabel("Variante", { exact: true }).selectOption("candidate");
  assert.ok((await page.locator(".case-list").innerText()).includes("Inconclusivo"));
  assert.ok((await page.locator(".case-list").innerText()).includes("Erro"));
  await page.getByLabel("Hipótese", { exact: true }).fill("Minha edição preservada");
  const current = await (await fetch(apiUrl + "/api/v1/suite", { headers: { Authorization: "Bearer " + token } })).json();
  await fetch(apiUrl + "/api/v1/suite", { method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "If-Match": '"' + current.revision + '"' }, body: JSON.stringify({ hypothesis: "Edição concorrente", cases: current.dataset.cases, settings: current.settings }) });
  await page.getByRole("button", { name: "Salvar revisão", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Outra revisão" }).waitFor();
  assert.equal(await page.getByLabel("Hipótese", { exact: true }).inputValue(), "Minha edição preservada");
  await page.screenshot({ path: directory + "/local-conflict.png", fullPage: true });
  await page.getByRole("button", { name: "Recarregar suíte" }).click();
  await page.waitForFunction(() => document.querySelector('input[maxlength="2000"]')?.value === "Edição concorrente");
  const options = await page.getByLabel("Referência", { exact: true }).locator("option").evaluateAll(items => items.map(item => item.value).filter(Boolean));
  await page.getByLabel("Referência", { exact: true }).selectOption(options[0]);
  await page.getByLabel("Candidata", { exact: true }).selectOption(options.at(-1));
  await page.getByRole("button", { name: "Comparar", exact: true }).click();
  await page.getByText("Execuções não comparáveis", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: directory + "/local-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(fileURLToPath(new URL("evidencias/ui-local.json", root)), JSON.stringify({ status: "passed", checks: ["seed-14", "execute", "failed-baseline", "editor", "error-and-inconclusive", "conflict-preserves-local", "reload", "incomparable-runs", "mobile-no-overflow"], consoleErrors: errors }, null, 2));
  console.log("UI checks passed: desktop, mobile, edit, execution, evidence, conflict and comparison.");
} finally { await browser.close(); await new Promise(resolve => dashboard.close(resolve)); await new Promise(resolve => api.close(resolve)); }
