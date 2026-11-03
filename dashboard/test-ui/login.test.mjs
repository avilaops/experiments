import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createApiServer } from "../../dist/lab/server.js";
import { createDashboard } from "../dist/server.mjs";

test("browser login works on mobile and desktop without a native Basic dialog", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-login-ui-"));
  const screenshots = fileURLToPath(new URL("../../reports/ui-check/login/", import.meta.url));
  await mkdir(screenshots, { recursive: true });
  const api = await createApiServer({ dataDirectory: directory, token: "synthetic-login-ui-token" });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  const server = createDashboard({ apiUrl: "http://127.0.0.1:" + api.address().port,
    apiToken: "synthetic-login-ui-token", username: "tester", password: "synthetic-login-ui-password",
    assetDirectory: fileURLToPath(new URL("../dist/", import.meta.url)) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browserType = process.env.LOGIN_BROWSER === "webkit" ? webkit : chromium;
  const browser = await browserType.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections(); api.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => api.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  });
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/experiments/policies");
    await page.getByRole("heading", { name: "Entre no laboratório", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/auth/login");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(screenshots, "login-" + (process.env.LOGIN_BROWSER ?? "chromium") + "-" + width + ".png"), fullPage: true });
    await page.getByLabel("Usuário", { exact: true }).fill("tester");
    await page.getByLabel("Senha", { exact: true }).fill("incorrect-password");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Usuário ou senha" }).waitFor();
    assert.equal(await page.getByLabel("Senha", { exact: true }).inputValue(), "");
    await page.getByLabel("Usuário", { exact: true }).fill("tester");
    await page.getByLabel("Senha", { exact: true }).fill("synthetic-login-ui-password");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(base + "/experiments/policies");
    await page.getByRole("button", { name: "Nova política", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Nova política", exact: true }).waitFor();
    const cookies = await context.cookies();
    assert.ok(cookies.some(cookie => cookie.httpOnly && cookie.sameSite === "Lax"));
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await page.getByRole("heading", { name: "Entre no laboratório", exact: true }).waitFor();
    await page.goto(base + "/experiments/policies");
    await page.getByRole("heading", { name: "Entre no laboratório", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
});
