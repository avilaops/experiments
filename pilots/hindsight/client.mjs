import { performance } from "node:perf_hooks";
import { MAX_BYTES, PilotError, RECORDS, safeText, validateArguments } from "./policy.mjs";

async function boundedJson(response) {
  if (!response.ok) throw new PilotError(`UPSTREAM_HTTP_${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new PilotError("UPSTREAM_INVALID");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new PilotError("UPSTREAM_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}

function usageOf(value) {
  if (!value || !["input_tokens", "output_tokens"].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
  return { input_tokens: value.input_tokens, output_tokens: value.output_tokens };
}

export function createMemoryClient({ url, apiKey, bank, expiresAt, enabled = true,
  timeoutMs = 15000, maxCalls = 12, fetchImpl = fetch, onMetric = () => {} }) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new PilotError("CONFIG_INVALID"); }
  const expiry = Date.parse(expiresAt);
  if (!Object.hasOwn(RECORDS, bank) || !["http:", "https:"].includes(endpoint.protocol)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/"
    || typeof apiKey !== "string" || apiKey.length < 24 || /[\s\r\n]/.test(apiKey)
    || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 14 * 86400000
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 30) throw new PilotError("CONFIG_INVALID");
  // Plain HTTP is restricted to container DNS or loopback; remote clients use TLS.
  if (endpoint.protocol === "http:" && !["hindsight", "127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw new PilotError("CONFIG_INVALID");
  }
  let calls = 0;
  return Object.freeze({ bank, async call(operation, args) {
    if (!enabled || Date.now() >= expiry) throw new PilotError("PILOT_DISABLED");
    validateArguments(bank, operation, args);
    if (calls >= maxCalls) throw new PilotError("CALL_LIMIT");
    calls++;
    const started = performance.now();
    const cpu = process.cpuUsage();
    let status = "failed", usage = null;
    try {
      const root = `${endpoint.origin}/v1/default/banks/${bank}`;
      const suffix = operation === "retain" ? "/memories" : operation === "recall" ? "/memories/recall" : "/reflect";
      const body = operation === "retain"
        ? { items: [{ content: args.content, document_id: "avl419-synthetic-decision", context: "synthetic technical decision" }], async: false }
        : { query: args.query, budget: "low", max_tokens: 256 };
      const response = await fetchImpl(root + suffix, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await boundedJson(response);
      usage = usageOf(data.usage);
      let result;
      if (operation === "retain") {
        if (data.success !== true || data.bank_id !== bank || data.async !== false || data.items_count !== 1) throw new PilotError("UPSTREAM_INVALID");
        result = { success: true };
      } else if (operation === "recall") {
        if (!Array.isArray(data.results) || data.results.length > 100) throw new PilotError("UPSTREAM_INVALID");
        result = { results: data.results.map(item => ({ text: safeText(bank, item.text) })) };
      } else result = { text: safeText(bank, data.text) };
      status = "succeeded";
      return result;
    } catch (error) {
      // Upstream errors may contain prompts, credentials and HTTP response bodies.
      throw error instanceof PilotError ? error : new PilotError("UPSTREAM_UNAVAILABLE");
    } finally {
      const elapsedCpu = process.cpuUsage(cpu);
      onMetric({ operation, status, latency_ms: Math.round((performance.now() - started) * 100) / 100,
        adapter_cpu_us: elapsedCpu.user + elapsedCpu.system, adapter_rss_bytes: process.memoryUsage().rss,
        usage, estimated_cost_usd: null, cost_scope: "provider ledger required; embeddings and background work excluded" });
    }
  } });
}
