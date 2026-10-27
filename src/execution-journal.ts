import { open } from "node:fs/promises";
import { canonicalJson } from "./json.js";
import type { ToolExecutionEvent } from "./tool-execution.js";

/** New private file only. No overwrite, replay, recovery or cross-process locking. */
export async function createFileExecutionJournal(file: string | URL) {
  const handle = await open(file, "wx", 0o600);
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  let failed = false;
  return {
    append(event: ToolExecutionEvent): Promise<void> {
      if (closed) return Promise.reject(new Error("Execution journal is closed"));
      const line = canonicalJson(event) + "\n";
      const operation = queue.then(async () => {
        if (failed) throw new Error("Execution journal failed");
        try { await handle.appendFile(line, "utf8"); await handle.sync(); }
        catch { failed = true; throw new Error("Execution journal write failed"); }
      });
      queue = operation.catch(() => undefined);
      return operation;
    },
    async close() {
      if (closed) return;
      closed = true;
      await queue;
      await handle.close();
    },
  };
}
