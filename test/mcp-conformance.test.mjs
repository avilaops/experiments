import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { checkMcp } from "../scripts/mcp/conformance.mjs";

async function serve(options = {}) {
  const methods = [];
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer test-secret-123456789") {
      res.writeHead(401).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const msg = JSON.parse(raw);
    methods.push(msg.method);
    if (msg.method === "initialize") {
      res.setHeader("mcp-session-id", "session-test");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mock", version: "1" } } }));
    } else if (msg.method === "notifications/initialized") {
      assert.equal(req.headers["mcp-session-id"], "session-test");
      res.writeHead(202).end();
    } else if (msg.method === "tools/list") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: {
        tools: options.duplicate ? [{ name: "read", inputSchema: { type: "object" } }, { name: "read", inputSchema: { type: "object" } }] :
          [{ name: "read", inputSchema: { type: "object", properties: {} } }],
      } }));
    } else {
      throw new Error("Unexpected method: " + msg.method);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: "http://127.0.0.1:" + server.address().port + "/mcp", methods };
}

test("conformance checks the handshake and schemas without tools/call", async () => {
  const { server, url, methods } = await serve();
  try {
    const result = await checkMcp({ url, token: "test-secret-123456789", allowLocalTest: true });
    assert.equal(result.verdict, "passed");
    assert.equal(result.toolCount, 1);
    assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list"]);
    assert.equal(result.toolsDigestSha256.length, 64);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("endpoint allowlist prevents arbitrary HTTP targets", async () => {
  await assert.rejects(checkMcp({ url: "http://127.0.0.1:3300/mcp", token: "test-secret-123456789" }), /allowlist/);
});

test("duplicate tool names fail conformance", async () => {
  const { server, url } = await serve({ duplicate: true });
  try {
    await assert.rejects(checkMcp({ url, token: "test-secret-123456789", allowLocalTest: true }), /Duplicate/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
