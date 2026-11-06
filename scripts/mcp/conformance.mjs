#!/usr/bin/env node
/** Read-only MCP transport conformance check. Never calls tools/call. */
import { createHash } from "node:crypto";

export const ALLOWED_HOSTS = new Set([
  "auth.avilaops.com", "mail.avilaops.com", "crm.avilaops.com",
  "tms.avilaops.com", "cms.avilaops.com", "lojas.avilaops.com",
  "erp.avilaops.com", "ml.avilaops.com", "n8n.avilaops.com",
  "mcp.avilaops.com", "avx.avilaops.com",
]);

function endpoint(input, allowLocalTest = false) {
  const url = new URL(input);
  const test = allowLocalTest && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(test && url.protocol === "http:")) ||
      url.username || url.password || url.hash || url.search ||
      (!ALLOWED_HOSTS.has(url.hostname) && !test)) {
    throw new Error("MCP endpoint not on the approved HTTPS allowlist");
  }
  return url;
}

function decode(body, contentType) {
  if (body.length > 512 * 1024) throw new Error("MCP response too large");
  if (contentType.includes("text/event-stream")) {
    const events = body.split(/\r?\n\r?\n/);
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(s => s.startsWith("data:")).map(s => s.slice(5).trim()).join("\n");
      if (data) {
        try {
          const value = JSON.parse(data);
          if (typeof value === "object" && value !== null && "jsonrpc" in value) return value;
        } catch { /* inspect next SSE event */ }
      }
    }
    throw new Error("MCP SSE response missing JSON-RPC data");
  }
  return JSON.parse(body);
}

async function exchange(url, token, body, sessionId, protocolVersion, timeoutMs) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": protocolVersion,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("MCP transport returned HTTP " + response.status);
  const content = await response.text();
  return { value: decode(content, response.headers.get("content-type") ?? ""), sessionId: response.headers.get("mcp-session-id") ?? sessionId };
}

function validTools(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.tools)) return false;
  return value.tools.every(item => item && typeof item.name === "string" && item.name.length > 0 &&
    typeof item.inputSchema === "object" && item.inputSchema !== null && !Array.isArray(item.inputSchema));
}

export async function checkMcp(options) {
  const { url: rawUrl, token, timeoutMs = 8000, allowLocalTest = false } = options;
  if (!token || token.length < 12) throw new Error("MCP_BEARER_TOKEN is required");
  const url = endpoint(rawUrl, allowLocalTest);
  const protocol = "2025-06-18";
  const initialized = await exchange(url, token, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "avila-mlops-conformance", version: "1" } },
  }, null, protocol, timeoutMs);
  const init = initialized.value;
  if (init?.id !== 1 || init?.jsonrpc !== "2.0" || init?.error || !init?.result?.protocolVersion) {
    throw new Error("Invalid MCP initialize handshake");
  }
  const version = init.result.protocolVersion;
  // Notification only. No mutation or tool invocation.
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": version,
      ...(initialized.sessionId ? { "Mcp-Session-Id": initialized.sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("MCP initialization notification failed: HTTP " + response.status);
  const tools = await exchange(url, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, initialized.sessionId, version, timeoutMs);
  if (tools.value?.id !== 2 || tools.value?.error || !validTools(tools.value?.result)) {
    throw new Error("MCP tools/list did not return valid schemas");
  }
  const names = tools.value.result.tools.map(x => x.name);
  if (new Set(names).size !== names.length) throw new Error("Duplicate MCP tool names");
  return {
    schema: "avila-mcp-transport-check/1", host: url.hostname, path: url.pathname,
    protocolVersion: version, verdict: "passed",
    toolCount: names.length,
    toolsDigestSha256: createHash("sha256").update(JSON.stringify([...names].sort())).digest("hex"),
    checks: ["initialize", "notifications/initialized", "tools/list"],
    notTested: ["OAuth permissions", "tenant isolation", "tools/call", "write operations", "production availability"],
  };
}

const invoked = process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href;
if (invoked) {
  const rawUrl = process.env.MCP_TARGET_URL;
  const token = process.env.MCP_BEARER_TOKEN;
  if (!rawUrl || !token) {
    console.log(JSON.stringify({ schema: "avila-mcp-transport-check/1", verdict: "unknown", reason: "Target URL or bearer credential missing" }));
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await checkMcp({ url: rawUrl, token })));
    } catch (error) {
      console.log(JSON.stringify({ schema: "avila-mcp-transport-check/1", verdict: "failed",
        reason: error instanceof Error ? error.message : "Unknown transport error" }));
      process.exitCode = 1;
    }
  }
}
