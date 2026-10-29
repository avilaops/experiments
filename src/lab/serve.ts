import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./server.js";
import { DEFAULT_DRAFT, type SuiteDraft } from "./contracts.js";

const host = process.env.LAB_HOST ?? "127.0.0.1";
const port = Number(process.env.LAB_PORT ?? 3300);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new TypeError("LAB_PORT must be an integer between 1 and 65535");
const token = process.env.LAB_API_TOKEN;
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !token?.trim()) {
  throw new TypeError("LAB_API_TOKEN is required when LAB_HOST is not loopback");
}
let seed: SuiteDraft = DEFAULT_DRAFT;
try {
  const dataset = JSON.parse(await readFile(new URL("../../examples/suites/calculation.cases.json", import.meta.url), "utf8"));
  seed = { ...DEFAULT_DRAFT, cases: dataset.cases };
} catch (error) {
  if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
}
const server = await createApiServer({
  dataDirectory: process.env.LAB_DATA_DIR ?? fileURLToPath(new URL("../../var/lab/", import.meta.url)),
  seed,
  ...(token === undefined ? {} : { token }),
  ...(process.env.LAB_ERP_CONTEXT_TOKEN === undefined ? {} : { contextToken: process.env.LAB_ERP_CONTEXT_TOKEN }),
  allowedOrigins: (process.env.LAB_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
});
server.listen(port, host, () => console.log(`Ávila Experiments API: http://${host.includes(":") ? `[${host}]` : host}:${port}`));
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => { process.exitCode = 0; }));
}
