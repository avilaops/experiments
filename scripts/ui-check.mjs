import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApiServer } from "../dist/lab/server.js";
import { DEFAULT_DRAFT } from "../dist/lab/contracts.js";
import { createDashboard } from "../dashboard/dist/server.mjs";
import { chromium } from "../dashboard/node_modules/playwright/index.mjs";

const root = new URL("../", import.meta.url);
const runId = randomUUID(), startedAt = new Date().toISOString();
const directory = fileURLToPath(new URL(`reports/ui-check/${runId}/`, root));
const pageErrors = [], consoleErrors = [], checks = [], runIds = [];
const credentials = { username: "tester", password: "local-verification-only-2026" };
let dataDirectory, api, dashboard, browser, page;
let status = "failed";
const close = async server => { if (server?.listening) { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
const listen = async server => {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return "http://127.0.0.1:" + server.address().port;
};
try {
  await mkdir(directory, { recursive: true });
  dataDirectory = await mkdtemp(path.join(tmpdir(), "avila-ui-check-"));
  const token = randomUUID();
  const seed = JSON.parse(await readFile(new URL("examples/suites/calculation.cases.json", root)));
  api = await createApiServer({ dataDirectory: dataDirectory, token, seed: { ...DEFAULT_DRAFT, cases: seed.cases } });
  const apiUrl = await listen(api);
  dashboard = createDashboard({ apiUrl, apiToken: token, ...credentials, assetDirectory: fileURLToPath(new URL("dashboard/dist/", root)) });
  const base = await listen(dashboard);
  const request = async (route, options = {}) => {
    const response = await fetch(apiUrl + route, { ...options, headers: { Authorization: "Bearer " + token, ...options.headers } });
    assert.equal(response.ok, true, `${route}: HTTP ${response.status}`);
    return { value: await response.json(), response };
  };
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ httpCredentials: credentials, viewport: { width: 1440, height: 1100 } });
  page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() }); });
  const clickResponse = async (name, route, method, expectedStatus) => {
    const result = page.waitForResponse(response => new URL(response.url()).pathname === "/experiments" + route && response.request().method() === method);
    await page.getByRole("button", { name, exact: true }).click();
    const response = await result;
    assert.equal(response.status(), expectedStatus);
    return response.json();
  };
  const execute = async () => {
    const value = await clickResponse("Executar suíte salva", "/api/v1/runs", "POST", 201);
    assert.match(value.id, /^[a-f0-9-]{36}$/);
    assert.ok(!runIds.includes(value.id)); runIds.push(value.id);
    await page.getByText(`Registro ${value.id}`, { exact: false }).waitFor();
    assert.equal((await request("/api/v1/runs/" + value.id)).value.id, value.id);
    return value;
  };
  await page.goto(base + "/experiments/");
  await page.getByLabel("Casos da suíte (JSON)").waitFor();
  assert.equal(JSON.parse(await page.getByLabel("Casos da suíte (JSON)").inputValue()).length, 14);
  const first = await execute(); checks.push("seed-14", "identified-execution");
  await page.getByLabel("Variante", { exact: true }).selectOption("baseline");
  const initialCase = page.getByLabel("Caso decimal-addition, repetição 1", { exact: true });
  await initialCase.locator("summary").click();
  assert.match(await initialCase.innerText(), /Reprovado/);
  assert.equal(first.baseline.cases.find(row => row.caseId === "decimal-addition").verdict, "failed");
  await page.screenshot({ path: path.join(directory, "desktop.png"), fullPage: true });
  const adversarial = [
    { id: "wrong-reference", input: { operation: "add", left: 1, right: 1 }, expected: 99 },
    { id: "no-reference", input: { operation: "add", left: 1, right: 1 } },
    { id: "division-zero", input: { operation: "divide", left: 1, right: 0 }, expected: 0 },
  ];
  await page.getByLabel("Casos da suíte (JSON)").fill(JSON.stringify(adversarial, null, 2));
  await clickResponse("Salvar revisão", "/api/v1/suite", "PUT", 200);
  await page.getByRole("button", { name: "Executar suíte salva", exact: true }).waitFor();
  const second = await execute();
  await page.getByLabel("Variante", { exact: true }).selectOption("candidate");
  for (const [id, verdict, label] of [["wrong-reference", "failed", "Reprovado"], ["no-reference", "inconclusive", "Inconclusivo"], ["division-zero", "error", "Erro"]]) {
    assert.equal(second.candidate.cases.find(row => row.caseId === id).verdict, verdict);
    assert.match(await page.getByLabel(`Caso ${id}, repetição 1`, { exact: true }).locator("summary").innerText(), new RegExp(label));
  }
  checks.push("adversarial-results-by-case-id");
  await page.getByLabel("Hipótese", { exact: true }).fill("Minha edição preservada");
  const current = await request("/api/v1/suite");
  assert.ok(Number.isSafeInteger(current.value.revision));
  assert.ok(Array.isArray(current.value.dataset.cases));
  assert.equal(current.response.headers.get("etag"), `"${current.value.revision}"`);
  const concurrent = await request("/api/v1/suite", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": current.response.headers.get("etag") }, body: JSON.stringify({ hypothesis: "Edição concorrente", cases: current.value.dataset.cases, settings: current.value.settings }) });
  assert.equal(concurrent.value.revision, current.value.revision + 1);
  assert.equal(concurrent.value.hypothesis, "Edição concorrente");
  await clickResponse("Salvar revisão", "/api/v1/suite", "PUT", 412);
  await page.getByRole("alert").filter({ hasText: "Outra revisão" }).waitFor();
  assert.equal(await page.getByLabel("Hipótese", { exact: true }).inputValue(), "Minha edição preservada");
  assert.deepEqual((await request("/api/v1/suite")).value, concurrent.value);
  await page.screenshot({ path: path.join(directory, "conflict.png"), fullPage: true });
  await clickResponse("Recarregar suíte", "/api/v1/suite", "GET", 200);
  await page.waitForFunction(() => [...document.querySelectorAll("label")].find(label => label.textContent.startsWith("Hipótese"))?.querySelector("input")?.value === "Edição concorrente");
  assert.equal(await page.getByLabel("Hipótese", { exact: true }).inputValue(), "Edição concorrente");
  checks.push("concurrent-save-confirmed", "conflict-preserves-local-and-persisted");
  assert.notEqual(first.candidate.dataset.hash, second.candidate.dataset.hash);
  const options = await page.getByLabel("Referência", { exact: true }).locator("option").evaluateAll(items => items.map(item => item.value).filter(Boolean));
  assert.ok(options.length >= 2);
  for (const id of [first.id + ":candidate", second.id + ":candidate"]) assert.ok(options.includes(id));
  await page.getByLabel("Referência", { exact: true }).selectOption(first.id + ":candidate");
  await page.getByLabel("Candidata", { exact: true }).selectOption(second.id + ":candidate");
  const comparison = await clickResponse("Comparar", "/api/v1/comparisons", "POST", 200);
  assert.equal(comparison.comparable, false);
  assert.ok(comparison.reasons.includes("Dataset snapshots differ"));
  await page.getByText("Execuções não comparáveis", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(directory, "mobile.png"), fullPage: true });
  checks.push("incompatible-run-ids-and-dataset", "mobile-no-overflow");
  await page.getByRole("link", { name: "Rotas por produto", exact: true }).click();
  await page.getByRole("heading", { name: "Inventário pendente", exact: true }).waitFor();
  if (process.env.ERP_INVENTORY_REPORT) {
    const inventoryBytes = await readFile(process.env.ERP_INVENTORY_REPORT);
    const inventory = JSON.parse(inventoryBytes);
    const importedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/experiments/api/v1/route-inventories/erp" && response.request().method() === "PUT");
    await page.getByLabel("Importar inventário JSON para este produto").setInputFiles({ name: "inventory.json", mimeType: "application/json", buffer: inventoryBytes });
    const response = await importedResponse; assert.equal(response.status(), 200);
    const imported = await response.json();
    assert.equal(imported.inventory.runId, inventory.runId);
    assert.equal(imported.inventory.sourceFingerprint, inventory.source.fingerprint);
    const total = inventory.web.pages.length + inventory.web.handlers.reduce((sum, row) => sum + Math.max(1, row.declaredMethods.length), 0) + (inventory.api?.operations.length ?? 0);
    assert.equal(imported.inventory.entries.length, total);
    await page.getByRole("heading", { name: `${total} registros encontrados de ${total}`, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(directory, "routes-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: path.join(directory, "routes-desktop.png"), fullPage: false });
    checks.push(`imported-erp-inventory:${inventory.runId}:${total}-records`);
  }
  assert.deepEqual(pageErrors, []);
  // Chromium reports the expected stale-edit response as a console network error.
  assert.deepEqual(consoleErrors.filter(item => !/^Failed to load resource: the server responded with a status of 412\b/.test(item.text)), []);
  status = "passed";
} finally {
  try {
    if (page && status === "failed") await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => {});
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "result.json"), JSON.stringify({ schemaVersion: "ui-check/2", runId, startedAt, completedAt: new Date().toISOString(), status,
      environment: "local_isolated", node: process.version, sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(root), encoding: "utf8" }).trim(),
      sourceDirty: execFileSync("git", ["status", "--porcelain"], { cwd: fileURLToPath(root), encoding: "utf8" }).trim().length > 0,
      checks, runIds, pageErrors, consoleErrors, expectedHttpErrors: [412], dataPreserved: process.env.KEEP_UI_DATA === "1",
      ...(process.env.KEEP_UI_DATA === "1" ? { dataDirectory } : {}) }, null, 2));
  } finally {
    try { if (browser) await browser.close(); }
    finally { try { await close(dashboard); } finally { try { await close(api); } finally {
      if (dataDirectory && process.env.KEEP_UI_DATA !== "1") {
        assert.equal(path.dirname(dataDirectory), tmpdir()); assert.ok(path.basename(dataDirectory).startsWith("avila-ui-check-"));
        await rm(dataDirectory, { recursive: true, force: true });
      }
    } } }
  }
}
console.log(JSON.stringify({ status, runId, directory, checks }));
