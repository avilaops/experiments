import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createMemoryClient } from "./client.mjs";
import { createDispatcher } from "./mcp.mjs";
import { MARKERS, QUESTION, RECORDS } from "./policy.mjs";

// Only a disposable CI service is allowed; never point this at production.
if (process.env.GITHUB_ACTIONS !== "true" || process.env.PILOT_LIVE_APPROVED !== "true"
  || process.env.HINDSIGHT_URL !== "http://127.0.0.1:18888"
  || !process.env.PILOT_PROVIDER || !process.env.PILOT_MODEL || !process.env.PILOT_COST_LIMIT_USD
  || !(Number(process.env.PILOT_COST_LIMIT_USD) > 0)) throw new Error("LIVE_CI_APPROVAL_REQUIRED");

const metrics = [], checks = [];
const url = process.env.HINDSIGHT_URL;
const apiKey = process.env.PILOT_API_KEY;
const expiresAt = new Date(Date.now() + 3600000).toISOString();
const report = { kind: "hindsight-live", revision: process.env.GITHUB_SHA, provider: process.env.PILOT_PROVIDER,
  model: process.env.PILOT_MODEL, cost_limit_usd: Number(process.env.PILOT_COST_LIMIT_USD), checks, metrics,
  phase: process.env.PILOT_PHASE ?? "seed", actual_total_cost_usd: null, provider_ledger_verified: false, decision: "pending-evidence" };
await mkdir("reports/hindsight", { recursive: true });
try {
  for (const token of [null, "invalid-synthetic-key"]) {
    const response = await fetch(`${url}/v1/default/banks/avl419-ci-a/memories/recall`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query: QUESTION }), signal: AbortSignal.timeout(3000), redirect: "error",
    });
    assert.ok([401, 403].includes(response.status));
    await response.body?.cancel();
  }
  checks.push({ name: "anonymous-and-invalid-key-denied", passed: true });
  const dispatchers = new Map();
  for (const bank of Object.keys(RECORDS)) {
    const dispatcher = createDispatcher(createMemoryClient({ url, apiKey, bank, expiresAt, onMetric: metric => metrics.push(metric) }));
    let id = 0;
    const request = (method, params) => dispatcher({ jsonrpc: "2.0", id: ++id, method, params });
    await request("initialize", { protocolVersion: "2025-03-26" });
    const invoke = async (name, args) => {
      const response = await request("tools/call", { name, arguments: args });
      assert.ok(!response.error && !response.result.isError, "MCP operation failed");
      return JSON.parse(response.result.content[0].text);
    };
    const denied = await request("tools/call", { name: "retain", arguments: { content: "Bearer SYNTHETIC_SENSITIVE_SENTINEL419" } });
    assert.equal(denied.result.isError, true);
    const foreign = await request("tools/call", { name: "recall", arguments: { query: QUESTION, bank_id: "foreign" } });
    assert.equal(foreign.result.isError, true);
    if (process.env.PILOT_PHASE !== "restored") await invoke("retain", { content: RECORDS[bank] });
    dispatchers.set(bank, invoke);
  }
  // Both banks already contain memories before either isolation check runs.
  for (const [bank, invoke] of dispatchers) {
    for (const operation of ["recall", "reflect"]) {
      const result = await invoke(operation, { query: QUESTION });
      const text = JSON.stringify(result);
      assert.ok(text.includes(MARKERS[bank]), "Expected synthetic marker absent");
      assert.ok(!text.includes(MARKERS[bank === "avl419-ci-a" ? "avl419-ci-b" : "avl419-ci-a"]), "Foreign bank leaked");
      assert.ok(!text.includes("SYNTHETIC_SENSITIVE_SENTINEL419"));
      checks.push({ name: `${bank}-${operation}-synthetic-quality`, passed: true });
    }
  }
  report.decision = "technical-flow-passed; provider-cost-ledger-still-required";
} catch {
  report.decision = "failed";
  process.exitCode = 1;
} finally {
  // Fresh CI volumes only. Cleanup must never be generalized to a shared server.
  for (const bank of process.env.PILOT_KEEP_FOR_RESTORE === "true" ? [] : Object.keys(RECORDS)) {
    try {
      const response = await fetch(`${url}/v1/default/banks/${bank}`, { method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(3000) });
      if (!response.ok && response.status !== 404) throw new Error();
      await response.body?.cancel();
    } catch { report.cleanup_failed = true; process.exitCode = 1; }
  }
  const filename = process.env.PILOT_PHASE === "restored" ? "restored" : "seed";
  await writeFile(`reports/hindsight/${filename}.json`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}
