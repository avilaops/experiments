import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createFileExecutionJournal, createFileToolOperationStore, createToolExecutor } from "../dist/index.js";

const [mode, argument] = process.argv.slice(2);
if (mode) {
  assert.ok(["execute", "reconcile"].includes(mode));
  const root = new URL(argument);
  const store = await createFileToolOperationStore(fileURLToPath(new URL("operations/", root)), await readFile(new URL("integrity.key", root)));
  const journal = await createFileExecutionJournal(new URL(`${mode}-${randomUUID()}.jsonl`, root));
  const executor = createToolExecutor({
    identity: {
      correlationId: randomUUID(), parentExecutionId: null, tenantId: "synthetic-tenant", principalId: "synthetic-operator",
      producer: { service: "durable-file-demo", version: "1" },
      versions: { code: "engineering-example/1", instruction: null, policy: "synthetic-receipts/1", model: null }, references: [],
    },
    operationStore: store, append: journal.append,
    authorize: request => request.identity.tenantId === "synthetic-tenant"
      && request.identity.principalId === "synthetic-operator" && request.tool === "commit_fixture"
      && request.arguments === null && request.action === mode,
    tools: [{ name: "commit_fixture", version: "1", execute: async () => {
      // This file represents a synthetic domain receipt. wx also prevents a duplicate
      // effect in the demo domain; the experiment store is not its transaction manager.
      await writeFile(new URL("domain-receipt.json", root), JSON.stringify({ reference: "synthetic-receipt-1" }), { flag: "wx", mode: 0o600 });
      throw new Error("Deliberately lose the response after committing the synthetic effect");
    }, reconcile: async () => {
      const receipt = JSON.parse(await readFile(new URL("domain-receipt.json", root), "utf8"));
      assert.equal(receipt.reference, "synthetic-receipt-1");
      return { output: null, effect: { status: "confirmed", reference: receipt.reference } };
    } }],
  });
  try {
    const result = await executor[mode]("commit_fixture", null, "synthetic-command-1");
    await executor.finish();
    console.log(JSON.stringify({ action: mode, status: result.status, effect: result.effect.status, outputAvailable: result.outputAvailable }));
  } finally { await journal.close(); }
} else {
  const root = new URL(`../reports/durable-tools/${randomUUID()}/`, import.meta.url);
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Local example only. Production must provision and back up a stable key separately.
  await writeFile(new URL("integrity.key", root), randomBytes(32), { flag: "wx", mode: 0o600 });
  const run = action => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), action, root.href], { encoding: "utf8" }));
  const results = [run("execute"), run("reconcile"), run("execute")];
  assert.equal(results[0].status, "failed");
  assert.equal(results[0].effect, "unknown");
  assert.equal(results[1].effect, "confirmed");
  assert.equal(results[2].status, "succeeded");
  assert.equal(results[2].outputAvailable, false);
  const verification = { synthetic: true, staging: false, processes: 3, results,
    codeRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0 };
  await writeFile(new URL("verification.json", root), JSON.stringify(verification, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ directory: fileURLToPath(root), verification: "passed", results }, null, 2));
}
