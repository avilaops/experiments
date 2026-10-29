import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createApiServer } from "../dist/lab/server.js";
import { ProductContextStore } from "../dist/lab/product-contexts.js";
import { createDashboard } from "../dashboard/dist/server.mjs";
import { chromium } from "../dashboard/node_modules/playwright/index.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const input = process.argv[2];
if (!input) throw new Error("Informe o arquivo de uma captura real do ERP. Este script não inventa contratos.");
const context = JSON.parse(await readFile(path.resolve(input), "utf8"));
const run = randomUUID();
const output = path.join(root, "reports/flows-review", run);
const credentials = { username: "local-review", password: "local-visual-review-only-2026" };
const errors = [];
let directory, api, dashboard, browser;
const listen = async server => { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); return `http://127.0.0.1:${server.address().port}`; };
const close = async server => { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
try {
  await mkdir(output, { recursive: true });
  directory = await mkdtemp(path.join(tmpdir(), "avila-flow-review-"));
  await new ProductContextStore(directory).save({ context, confirmPublication: false }, 0);
  api = await createApiServer({ dataDirectory: directory, token: "local-review-token" });
  const apiUrl = await listen(api);
  dashboard = createDashboard({ apiUrl, apiToken: "local-review-token", ...credentials, assetDirectory: path.join(root, "dashboard/dist") });
  const base = await listen(dashboard);
  browser = await chromium.launch({ headless: true });
  const session = await browser.newContext({ httpCredentials: credentials, viewport: { width: 1440, height: 1100 } });
  const page = await session.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/experiments/flows");
  await page.getByRole("heading", { name: "Usuários e convites", exact: true }).waitFor();
  await page.getByText("23 funcionalidades · 96 ações", { exact: true }).waitFor();
  await page.getByRole("region", { name: "Ações da funcionalidade" }).getByText("Registrar convite e solicitar envio ao Auth", { exact: true }).click();
  await page.getByText("InvitationInput", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "users-desktop.png") });
  await page.screenshot({ path: path.join(output, "users-full.png"), fullPage: true });
  await page.getByLabel("Buscar funcionalidade", { exact: true }).fill("/api/v1/products");
  assert.ok(await page.locator(".flow-directory-list li").count() > 0);
  await page.getByLabel("Buscar funcionalidade", { exact: true }).fill("impossible-flow-query");
  await page.getByText("Nenhuma funcionalidade corresponde aos filtros.", { exact: true }).waitFor();
  await page.getByLabel("Buscar funcionalidade", { exact: true }).fill("");
  const productTitle = context.flows.find(flow => flow.definition.id === "products").definition.title;
  await page.getByRole("button").filter({ has: page.getByText(productTitle, { exact: true }) }).click();
  await page.getByRole("heading", { name: productTitle, exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole("heading", { name: productTitle, exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "products-mobile.png") });
  await page.getByLabel("Captura de contexto", { exact: true }).selectOption("published");
  await page.getByRole("alert").getByText("Captura indisponível", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Voltar à última importação" }).click();
  await page.getByRole("heading", { name: productTitle, exact: true }).waitFor();
  assert.deepEqual(errors, []);
  const result = { status: "passed", scope: "Local browser review using the real imported source capture; no ERP business flow executed", sourceCommit: context.source.commit, contentSha256: context.contentSha256, flows: context.flows.length, actions: context.actions.length, checks: ["users and invitation contract", "route search", "empty filter", "flow navigation", "mobile overflow", "unobserved publication recovery"], screenshots: ["users-desktop.png", "products-mobile.png"], pageErrors: errors };
  await writeFile(path.join(output, "review.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, output }, null, 2));
} finally {
  try { if (browser) await browser.close(); }
  finally { try { await close(dashboard); } finally { await close(api); if (directory) { assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith("avila-flow-review-")); await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } } }
}
