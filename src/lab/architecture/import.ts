import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Pool } from "pg";
import { ApiError } from "../contracts.js";
import { transaction } from "./database.js";
import { changeNote } from "./schema.js";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export interface SourceSnapshot { path: string; sha256: string; payload: unknown }

/** Archive the current JSON stores without interpreting their claims as verification. */
export async function previewSources(directory: string) {
  const root = await realpath(directory);
  const snapshots: SourceSnapshot[] = [];
  let bytes = 0;
  async function visit(path: string, depth: number): Promise<void> {
    if (depth > 8) throw new Error("Source directory nesting exceeds limit");
    let stat;
    try { stat = await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && depth === 0) return; throw error; }
    if (stat.isSymbolicLink()) throw new Error("Source symlinks are not accepted");
    const canonical = await realpath(path);
    if (!canonical.startsWith(root + sep)) throw new Error("Source outside data directory");
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), depth + 1);
    } else if (stat.isFile() && path.endsWith(".json")) {
      if (stat.size > 16 * 1024 * 1024 || snapshots.length >= 10000 || bytes + stat.size > 128 * 1024 * 1024) throw new Error("Source archive exceeds size limits");
      const content = await readFile(path);
      bytes += content.length;
      if (content.length > 16 * 1024 * 1024 || bytes > 128 * 1024 * 1024) throw new Error("Source archive exceeds size limits");
      snapshots.push({ path: relative(root, path).split(sep).join("/"), sha256: digest(content), payload: JSON.parse(content.toString("utf8")) as unknown });
    }
  }
  // Explicit allowlist: never walk arbitrary configuration or secret directories.
  for (const name of ["policies.json", "suite.json", "client-contracts.json", "runs-index.json", "route-inventories", "product-contexts", "runs"]) await visit(resolve(root, name), 0);
  const manifest = snapshots.map(({ path, sha256 }) => ({ path, sha256 }));
  return { sha256: digest(JSON.stringify(manifest)), bytes, manifest, snapshots };
}

export async function importSources(pool: Pool, directory: string, expectedDigest: string, expectedRevision: number, note: string) {
  const reason = changeNote(note);
  const preview = await previewSources(directory);
  if (preview.sha256 !== expectedDigest) throw new ApiError(412, "SOURCE_CHANGED", "Os arquivos mudaram desde a prévia.");
  return transaction(pool, async client => {
    const state = await client.query("SELECT revision FROM experiments_architecture.catalog_revision WHERE singleton FOR UPDATE");
    const revision = state.rows[0]?.revision as number;
    if (revision !== expectedRevision) throw new ApiError(412, "REVISION_CONFLICT", "O catálogo mudou desde a prévia.");
    const imported: { path: string; sha256: string }[] = [];
    for (const source of preview.snapshots) {
      const result = await client.query("INSERT INTO experiments_architecture.source_snapshots(source_path,content_sha256,payload) VALUES ($1,$2,$3) ON CONFLICT (source_path,content_sha256) DO NOTHING", [source.path, source.sha256, JSON.stringify(source.payload)]);
      if (result.rowCount) imported.push({ path: source.path, sha256: source.sha256 });
    }
    if (!imported.length) return { revision, imported: 0, preserved: preview.snapshots.length };
    const next = revision + 1;
    await client.query("UPDATE experiments_architecture.catalog_revision SET revision=$1 WHERE singleton", [next]);
    await client.query("INSERT INTO experiments_architecture.changes(revision,entity,record_id,change_note,snapshot,actor) VALUES ($1,$2,$3,$4,$5,$6)", [next, "source_snapshots", preview.sha256, reason, JSON.stringify(imported), "database-import-operator"]);
    return { revision: next, imported: imported.length, preserved: preview.snapshots.length - imported.length };
  });
}
