import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { parsePolicyImportDocument } from "../dist/lab/policies.js";

const execute = promisify(execFile);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function sourceLocation(source) {
  if (!source || typeof source !== "object" ||
      typeof source.repository !== "string" || !/^[a-z][a-z0-9-]*$/.test(source.repository) ||
      typeof source.remote !== "string" || !/^https:\/\/github\.com\/avilaops\/[A-Za-z0-9_.-]+$/.test(source.remote) ||
      typeof source.revision !== "string" || !/^[a-f0-9]{40}$/.test(source.revision) ||
      typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) ||
      typeof source.path !== "string" || !source.path || /[\\:#\x00-\x1f]/.test(source.path) ||
      source.path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Fonte inválida: informe repositório, origem GitHub, commit, caminho relativo e SHA-256.");
  }
  return `${source.remote}/blob/${source.revision}/${source.path}`;
}

/** Confers bytes and reference coverage. It does not run or attest product rules. */
export async function verifyPolicyInventory({ policies, manifest, readBlob }) {
  const drafts = parsePolicyImportDocument(policies);
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources) ||
      manifest.sources.length < 1 || manifest.sources.length > 500) throw new Error("Manifesto de fontes inválido.");
  const indexed = new Map();
  const repositories = new Map();
  for (const source of manifest.sources) {
    const location = sourceLocation(source);
    if (indexed.has(location)) throw new Error("Fonte duplicada no manifesto.");
    const identity = `${source.remote}@${source.revision}`;
    if (repositories.has(source.repository) && repositories.get(source.repository) !== identity) {
      throw new Error("Um repositório do inventário deve apontar para uma única origem e revisão.");
    }
    repositories.set(source.repository, identity);
    indexed.set(location, source);
  }
  const referenced = new Set();
  for (const policy of drafts) {
    if (!policy.sources.length) throw new Error(`${policy.id}: ficha sem fontes no inventário.`);
    for (const reference of policy.sources) {
      const location = reference.location.split("#")[0];
      if (!indexed.has(location)) throw new Error(`${policy.id}: referência ausente do manifesto.`);
      referenced.add(location);
    }
  }
  if (referenced.size !== indexed.size) throw new Error("O manifesto contém fonte sem referência nas fichas.");
  if (typeof readBlob !== "function") throw new Error("Informe o leitor dos blobs Git.");
  for (const source of indexed.values()) {
    const bytes = await readBlob(source);
    if (!(bytes instanceof Uint8Array) || digest(bytes) !== source.sha256) {
      throw new Error(`${source.repository}/${source.path}: SHA-256 divergente.`);
    }
  }
  return { sourceIntegrityVerified: true, productRuntimeVerified: false, policies: drafts.length,
    repositories: repositories.size, sources: indexed.size, inventorySha256: digest(JSON.stringify(drafts)) };
}

/** Reads the pinned Git blob, including in sparse checkouts; never changes HEAD. */
export function gitSourceReader(repositories) {
  const checked = new Set();
  return async source => {
    sourceLocation(source);
    const root = repositories?.[source.repository];
    if (typeof root !== "string" || !root.trim()) throw new Error(`Informe o checkout de ${source.repository}.`);
    const git = async args => execute("git", ["-C", root, ...args], {
      encoding: "buffer", maxBuffer: 5 * 1024 * 1024, timeout: 30000, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    try {
      if (!checked.has(source.repository)) {
        const { stdout } = await git(["remote", "get-url", "origin"]);
        if (stdout.toString().trim().replace(/\.git$/, "") !== source.remote) throw new Error("Origem divergente.");
        checked.add(source.repository);
      }
      return (await git(["show", `${source.revision}:${source.path}`])).stdout;
    } catch {
      throw new Error(`${source.repository}/${source.path}: não foi possível conferir o blob e sua origem.`);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [inventoryFile, manifestFile, repositoriesFile, ...extra] = process.argv.slice(2);
    if (!inventoryFile || !manifestFile || !repositoriesFile || extra.length) {
      throw new Error("Uso: node scripts/verify-policy-inventory.mjs fichas.json fontes.json checkouts.json");
    }
    const [policies, manifest, repositories] = await Promise.all(
      [inventoryFile, manifestFile, repositoriesFile].map(async file => JSON.parse(await readFile(file, "utf8"))),
    );
    console.log(JSON.stringify(await verifyPolicyInventory({ policies, manifest, readBlob: gitSourceReader(repositories) }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
