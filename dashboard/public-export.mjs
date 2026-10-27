import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactName = /^[a-z-]+\.json$/;

async function exactEntries(directory, expected) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some(entry => entry.isSymbolicLink()) ||
      JSON.stringify(entries.map(entry => entry.name).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Unexpected public entries in ${directory}`);
  }
  return entries;
}

export async function validatePublicExport(directory, allowed) {
  directory = directory instanceof URL ? fileURLToPath(directory) : directory;
  if (!Array.isArray(allowed) || allowed.some(name => typeof name !== "string" || !artifactName.test(name)) ||
      new Set(allowed).size !== allowed.length) throw new Error("Invalid public allowlist");
  const entries = await exactEntries(directory, ["index.html", "style.css", "manifest.json", "data"]);
  if (entries.some(entry => entry.name === "data" ? !entry.isDirectory() : !entry.isFile())) {
    throw new Error("Invalid public entry type");
  }
  const data = await exactEntries(path.join(directory, "data"), allowed);
  if (data.some(entry => !entry.isFile())) throw new Error("Public evidence must be regular files");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== allowed.length ||
      new Set(manifest.artifacts.map(item => item.file)).size !== allowed.length ||
      manifest.artifacts.some(item => !allowed.includes(item.file))) throw new Error("Manifest differs from allowlist");
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(path.join(directory, "data", artifact.file));
    JSON.parse(bytes.toString("utf8"));
    if (bytes.length !== artifact.size || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      throw new Error(`Public evidence integrity mismatch: ${artifact.file}`);
    }
  }
}

// Build off-line first. Directory replacement uses two renames with rollback;
// it is not a zero-downtime atomic swap for a web server serving this path.
export async function publishPublicExport(directory, allowed, populate) {
  const root = await realpath(directory);
  const lockPath = path.join(root, ".public-build.lock");
  const lock = await open(lockPath, "wx");
  let workspace;
  let preserveBackup = false;
  try {
    workspace = await mkdtemp(path.join(root, ".public-build-"));
    const output = path.join(workspace, "site");
    const previous = path.join(workspace, "previous");
    const target = path.join(root, "public");
    await populate(output);
    await validatePublicExport(output, allowed);
    let hadPrevious = false;
    try {
      const entry = await lstat(target);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Public output must be a real directory");
      await rename(target, previous);
      hadPrevious = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(output, target);
    } catch (error) {
      if (hadPrevious) {
        try { await rename(previous, target); }
        catch (restoreError) {
          preserveBackup = true;
          throw new AggregateError([error, restoreError], `Restore public output from ${previous}`);
        }
      }
      throw error;
    }
  } finally {
    try {
      if (workspace && !preserveBackup) {
        if (path.dirname(workspace) !== root || !path.basename(workspace).startsWith(".public-build-")) {
          throw new Error("Refusing to remove a path outside the build workspace");
        }
        await rm(workspace, { recursive: true, force: true });
      }
    } finally {
      await lock.close();
      await rm(lockPath);
    }
  }
}
