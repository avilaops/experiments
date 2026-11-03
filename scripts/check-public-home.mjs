import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "../dashboard/node_modules/playwright/index.mjs";

const html = await readFile(new URL("../site/index.html", import.meta.url));
const server = createServer((req, res) => {
  if (req.url !== "/") { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  await mkdir(new URL("../reports/public-home/", import.meta.url), { recursive: true });
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto("http://127.0.0.1:" + server.address().port);
    assert.equal(response.status(), 200);
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(await page.getByRole("link", { name: "Acessar plataforma" }).getAttribute("href"), "/experiments/");
    assert.equal(await page.getByRole("link", { name: "Explorar evidências" }).getAttribute("href"), "/evidencias/");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "horizontal overflow");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: new URL(`../reports/public-home/${width}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
    await page.close();
  }
  console.log("Public home: anonymous access and responsive layout passed (390px, 1440px).");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
