import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { fingerprint } from "../dist/index.js";
import { captureStableInventory, diagnostic } from "./inventory-erp-routes.mjs";
import { InventoryError, inventoryWeb, stableFile } from "./route-inventory/source.mjs";
import { parseRouteInventory } from "../dist/lab/route-inventories.js";

/** Captures Auth source declarations only; does not log in or execute Auth operations. */
export async function captureAuthInventory(root) {
  const packageFile = await stableFile(path.join(root, "package.json"));
  const manifest = JSON.parse(packageFile.bytes.toString("utf8"));
  if (manifest.name !== "avilaops-auth" || !manifest.dependencies?.next) {
    throw new InventoryError("source-identity", "NOT_AUTH_REPOSITORY");
  }
  const appRoot = path.join(root, "src", "app");
  const capture = await captureStableInventory(root, { scan: () => inventoryWeb(appRoot) });
  const packageAfter = await stableFile(path.join(root, "package.json"));
  if (packageFile.sha256 !== packageAfter.sha256 || packageFile.metadata !== packageAfter.metadata) {
    throw new InventoryError("consistency", "AUTH_MANIFEST_CHANGED", { retryable: true });
  }
  const { metadataFingerprint, ...web } = capture.web;
  const counts = {
    pages: web.pages.length,
    handlerPaths: web.handlers.length,
    declaredMethods: web.handlers.reduce((sum, row) => sum + row.declaredMethods.length, 0),
    callableMethods: web.handlers.reduce((sum, row) => sum + row.methods.length, 0),
    reviewItems: web.review.length,
    conflicts: web.conflicts.length,
  };
  const report = {
    schemaVersion: "route-inventory/2", product: "auth", runId: randomUUID(), recordedAt: new Date().toISOString(),
    tools: { node: process.version, typescript: ts.version },
    source: {
      repository: "https://github.com/avilaops/auth.avilaops.com", appDirectory: "src/app",
      head: capture.git.before.head, dirty: capture.git.before.dirty, git: capture.git,
      fingerprint: fingerprint({ web, packageSha256: packageFile.sha256 }), metadataFingerprint,
      scope: "Next page and route files under src/app, including .well-known discovery, plus package.json.",
    },
    consistency: capture.consistency, counts, web, api: null,
    limitations: [
      "Source declarations are not functional or production verification; every entry remains not_run.",
      "The catalog groups Next route handlers under its bff layer. No separate OpenAPI contract was captured.",
      "Proxy host routing, middleware, server actions, implicit HTTP methods and imported implementations are outside this inventory.",
      "Only the observed route sources and package manifest are fingerprinted, not the complete application.",
    ],
  };
  parseRouteInventory(report);
  return report;
}

export async function main(args) {
  if (args.length !== 1) throw new InventoryError("arguments", "INVALID_ARGUMENTS");
  const report = await captureAuthInventory(path.resolve(args[0]));
  const directory = new URL(`../reports/auth-inventory/${report.runId}/`, import.meta.url);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(new URL("inventory.json", directory), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ product: "auth", runId: report.runId, directory: fileURLToPath(directory),
    sourceHead: report.source.head, sourceDirty: report.source.dirty, counts: report.counts }, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify(diagnostic(error))); process.exitCode = 1; });
}
