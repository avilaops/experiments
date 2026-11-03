import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDashboard } from "../dist/server.mjs";

const options = {
  apiUrl: "http://127.0.0.1:1",
  apiToken: "synthetic-upstream-token",
  assetDirectory: "unused",
};
const oidc = {
  issuer: "https://identity.example",
  clientId: "synthetic-client",
  clientSecret: "synthetic-client-secret",
  redirectUri: "https://lab.example/auth/callback",
};

test("the BFF refuses to start without a complete authentication mechanism", () => {
  for (const credentials of [{}, { username: "", password: "" }, { username: "  ", password: "" }]) {
    assert.throws(() => createDashboard({ ...options, ...credentials }), /authentication|required|credentials/i);
  }
});

test("an incomplete OIDC object cannot enable an unprotected dashboard", () => {
  for (const field of ["issuer", "clientId", "clientSecret", "redirectUri"]) {
    assert.throws(() => createDashboard({ ...options, oidc: { ...oidc, [field]: " " } }), /OIDC|configuration/i);
  }
});

test("partial OIDC environment fails before listening even when Basic is configured", () => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith("OIDC_") && !key.startsWith("DASHBOARD_") && key !== "LAB_API_TOKEN"));
  for (const partial of [
    { OIDC_CLIENT_ID: "synthetic-client" },
    { OIDC_CLIENT_SECRET: "synthetic-secret" },
    { OIDC_ISSUER: "https://identity.example" },
  ]) {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/serve.mjs", import.meta.url))], {
      env: { ...clean, LAB_API_TOKEN: "synthetic-api-token", DASHBOARD_HOST: "127.0.0.1", DASHBOARD_PORT: "0",
        DASHBOARD_USER: "tester", DASHBOARD_PASSWORD: "long-test-password-123", ...partial },
      encoding: "utf8",
      timeout: 2000,
    });
    assert.equal(child.error, undefined, "the invalid configuration must exit rather than keep serving");
    assert.equal(child.status, 1);
    assert.match(child.stderr, /OIDC/);
    assert.ok(!child.stderr.includes("synthetic-secret"));
  }
});

test("complete OIDC protects both API aliases while keeping login and health available", async t => {
  const server = createDashboard({ ...options, oidc });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await fetch(base + "/health")).status, 200);
  for (const path of ["/api/v1/runs", "/experiments/api/v1/runs", "/experiments/"]) {
    const response = await fetch(base + path, { redirect: "manual", headers: { Cookie: "avila_lab_session=invalid" } });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location"), base).pathname, "/auth/login");
  }
  const login = await fetch(base + "/auth/login", { redirect: "manual" });
  assert.equal(login.status, 302);
  const target = new URL(login.headers.get("location"));
  assert.equal(target.origin, "https://identity.example");
  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.ok(!target.toString().includes("synthetic-client-secret"));
});
