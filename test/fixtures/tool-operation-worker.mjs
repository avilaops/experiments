import { appendFile } from "node:fs/promises";
import { createFileToolOperationStore, createToolExecutor } from "../../dist/index.js";

const [directory, effectFile, mode = "crash"] = process.argv.slice(2);
const operationStore = await createFileToolOperationStore(directory, Buffer.alloc(32, 7));
const executor = createToolExecutor({
  identity: {
    correlationId: "worker-request", parentExecutionId: null, tenantId: "tenant-a", principalId: "operator-a",
    producer: { service: "test-host", version: "1" },
    versions: { code: "test", instruction: null, policy: "policy-1", model: null }, references: [],
  },
  tools: [{ name: "commit", version: "1", execute: async () => {
    await appendFile(effectFile, "committed\n");
    // Exit after the real effect and before the operation result can be recorded.
    if (mode === "crash") process.exit(23);
    return { output: null, effect: { status: "confirmed", reference: "worker-receipt" } };
  } }],
  authorize: () => true, append: () => undefined, operationStore,
});
const result = await executor.execute("commit", { amount: 1 }, "crash-key");
console.log(JSON.stringify(result));
