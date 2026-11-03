import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApiServer } from "../../dist/lab/server.js";
import { createDashboard } from "../dist/server.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-login-test-"));
  const api = await createApiServer({ dataDirectory: directory, token: "synthetic-login-api-token" });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  const server = createDashboard({ apiUrl: "http://127.0.0.1:" + api.address().port,
    apiToken: "synthetic-login-api-token", username: "tester", password: "synthetic-login-password",
    assetDirectory: new URL("../dist/", import.meta.url).pathname });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    server.closeAllConnections(); api.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => api.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  });
  const login = (extra = {}) => fetch(base + "/auth/login", {
    method: "POST", redirect: "manual",
    headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded", ...extra.headers },
    body: new URLSearchParams({ username: "tester", password: "synthetic-login-password",
      returnTo: "/experiments/policies", ...extra.fields }),
  });
  return { base, login };
}

test("HTML navigation gets a usable login page while API clients retain JSON 401", async t => {
  const { base } = await fixture(t);
  const page = await fetch(base + "/experiments/policies", { headers: { Accept: "text/html" }, redirect: "manual" });
  assert.equal(page.status, 303);
  assert.equal(new URL(page.headers.get("location"), base).pathname, "/auth/login");
  const login = await fetch(base + page.headers.get("location"));
  assert.equal(login.status, 200);
  assert.match(login.headers.get("content-type"), /text\/html/);
  const html = await login.text();
  assert.match(html, /Entre no laboratório/);
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.ok(!html.includes("synthetic-login-api-token"));
  for (const route of ["/api/v1/runs", "/experiments/api/v1/runs"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("content-type"), /application\/json/);
  }
});

test("a form login establishes a private session and logout revokes it", async t => {
  const { base, login } = await fixture(t);
  const response = await login();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/experiments/policies");
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.ok(!setCookie.includes("synthetic-login-password"));
  assert.ok(!setCookie.includes("synthetic-login-api-token"));
  const cookie = setCookie.split(";")[0];
  assert.equal((await fetch(base + "/experiments/policies", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + "/api/v1/runs", { headers: { Cookie: cookie } })).status, 200);
  const logout = await fetch(base + "/auth/logout", { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: base } });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await fetch(base + "/api/v1/runs", { headers: { Cookie: cookie } })).status, 401);
});

test("invalid credentials render a readable form without a browser Basic challenge", async t => {
  const { login } = await fixture(t);
  const response = await login({ fields: { password: "wrong-password" } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  const html = await response.text();
  assert.match(html, /role="alert"/);
  assert.match(html, /Usuário ou senha/);
  assert.ok(!html.includes("wrong-password"));
});

test("login rejects cross-origin submission and redirect targets stay on the laboratory", async t => {
  const { base, login } = await fixture(t);
  const forbidden = await login({ headers: { Origin: "https://hostile.example" } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("set-cookie"), null);
  for (const returnTo of ["https://hostile.example", "//hostile.example", "/\\hostile.example", "/auth/login", "/experiments/../auth/login", "/experiments/%2e%2e/auth/login", "/%2f%2fhostile.example"]) {
    const response = await login({ fields: { returnTo } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/experiments/");
  }
  const response = await login();
  const cookie = response.headers.get("set-cookie").split(";")[0];
  for (const headers of [{ Cookie: cookie }, { Cookie: cookie, Authorization: "Basic invalid" }, { Cookie: cookie, Origin: "https://hostile.example" }]) {
    const mutation = await fetch(base + "/api/v1/runs", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(mutation.status, 403);
  }
  assert.equal((await fetch(base + "/api/v1/runs", { headers: { Cookie: "avila_lab_basic_session=forged" } })).status, 401);
});
