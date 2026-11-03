import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createApiServer } from "../../dist/lab/server.js";
import { createDashboard } from "../dist/server.mjs";

test("private reference loads real OpenAPI through the BFF without issuing mutations", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-reference-ui-"));
  const servers = [];
  let browser;
  t.after(async () => {
    await browser?.close();
    for (const server of servers.reverse()) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-reference-ui-"));
    await rm(directory, { recursive: true, force: true });
  });
  const listen = async server => {
    servers.push(server);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return "http://127.0.0.1:" + server.address().port;
  };
  const token = "ephemeral-reference-api-token";
  const apiUrl = await listen(await createApiServer({ dataDirectory: directory, token }));
  const base = await listen(createDashboard({ apiUrl, apiToken: token,
    username: "tester", password: "ephemeral-reference-password",
    assetDirectory: fileURLToPath(new URL("../dist/", import.meta.url)) }));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ httpCredentials: {
    username: "tester", password: "ephemeral-reference-password" },
    extraHTTPHeaders: { Authorization: "Basic " + Buffer.from("tester:ephemeral-reference-password").toString("base64") },
    viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [], mutations = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method())) mutations.push(request.url());
  });
  await page.goto(base + "/experiments/docs");
  await page.getByRole("button", { name: "Abrir API do laboratório" }).click();
  await page.getByRole("heading", { name: "Salvar contrato", exact: true }).waitFor();
  await page.getByRole("button", { name: "Rust", exact: true }).click();
  assert.ok((await page.locator(".reference-examples").innerText()).includes("AVILA_API_TOKEN"));
  assert.ok(!(await page.content()).includes(token));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Navegar na documentação" }).click();
  await page.getByLabel("Buscar na documentação").fill("nao-existe-endpoint");
  await page.getByText("Nenhum resultado para esta busca.").waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
});
