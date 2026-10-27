import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createFileExecutionJournal, createToolExecutor, pathFidelity, toolExecutionPath } from "../dist/index.js";

// One fixed, synthetic source. Invocation arguments cannot choose a file or an endpoint.
const source = new URL("./fiscal/domestic-sale.context.json", import.meta.url);
const directory = new URL(`../reports/tool-execution/${randomUUID()}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const journal = await createFileExecutionJournal(new URL("private.jsonl", directory));
const code = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let reads = 0;
const executor = createToolExecutor({
  identity: {
    correlationId: randomUUID(), parentExecutionId: null,
    tenantId: "synthetic-tenant", principalId: "local-demo",
    producer: { service: "fixed-reference-reader", version: "1" },
    versions: { code, instruction: null, policy: "fixed-synthetic-source/1", model: null },
    references: [{ id: "domestic-sale.context", version: "0.1" }],
  },
  authorize: ({ identity, tool, arguments: input }) => identity.tenantId === "synthetic-tenant"
    && identity.principalId === "local-demo" && tool === "read_reference" && input === null,
  tools: [{ name: "read_reference", version: "1", execute: async (_, context) => {
    const bytes = await readFile(source, { signal: context.signal });
    reads++;
    return { output: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, effect: { status: "none" } };
  } }],
  append: journal.append,
});

try {
  const first = await executor.execute("read_reference", null, "read-synthetic-reference");
  const repeated = await executor.execute("read_reference", null, "read-synthetic-reference");
  assert.equal(first.status, "succeeded");
  assert.deepEqual(first.output, repeated.output);
  assert.equal(reads, 1);
  const trace = await executor.finish();
  const assessment = pathFidelity({ requiredNodes: ["read_reference"] }).evaluate({ output: { trace: toolExecutionPath(trace) } });
  assert.equal(assessment.score, 1);
  await writeFile(new URL("verification.json", directory), JSON.stringify({
    executionId: executor.executionId, syntheticData: true, realLocalFileRead: true,
    staging: false, originAuthenticated: false, workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    reads, assessment, trace,
  }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ executionId: executor.executionId, directory: directory.pathname, reads, verification: "passed" }, null, 2));
} finally { await journal.close(); }
