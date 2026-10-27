import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import ts from "typescript";

// Fixed read-only target and commands. Never request container environment or data volumes.
const target = "apps-noclient";
const api = "avila-experiments-api-1";
function ssh(command) {
  return execFileSync("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", target, command], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 60_000,
  }).trim();
}
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim();
}

const image = JSON.parse(ssh(`docker inspect --format '{"containerId":"{{.Id}}","imageId":"{{.Image}}","imageTag":"{{.Config.Image}}","startedAt":"{{.State.StartedAt}}"}' ${api}`));
if (!/^sha256:[0-9a-f]{64}$/.test(image.imageId) || !/^[0-9a-f]{64}$/.test(image.containerId)) {
  throw new Error("Unexpected image or container identifier");
}
const imageRevision = ssh(`docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' ${image.imageId}`);
const lines = ssh(`docker exec ${api} find /app/dist -type f -name '*.js' -exec sha256sum {} +`).split(/\r?\n/);
const artifacts = lines.map(line => {
  const match = /^([0-9a-f]{64})\s+\/app\/dist\/([a-zA-Z0-9_./-]+\.js)$/.exec(line);
  if (!match || match[2].split("/").includes("..")) throw new Error("Unexpected artifact hash response");
  return { file: `dist/${match[2]}`, sha256: match[1] };
}).sort((left, right) => left.file.localeCompare(right.file));
if (!artifacts.length) throw new Error("No deployed JavaScript artifacts found");

const comparisons = git(["rev-list", "--all"]).split(/\r?\n/).map(commit => {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Invalid Git revision");
  const files = git(["ls-tree", "-r", "--name-only", commit, "src"]).split(/\r?\n/).filter(file => file.endsWith(".ts"));
  const compiled = new Map(files.map(file => {
    const source = execFileSync("git", ["show", `${commit}:${file}`], { encoding: "utf8" });
    // .mts selects ESM as package.json does for the real tsc project.
    // Normalize only the source-map filename, since the deployed files use .js.
    const output = ts.transpileModule(source, { fileName: file.replace(/\.ts$/, ".mts"), compilerOptions: {
      target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, verbatimModuleSyntax: true, sourceMap: true,
    } }).outputText.replace(/sourceMappingURL=([^\n]+)\.mjs\.map/, "sourceMappingURL=$1.js.map");
    return [file.replace(/^src\//, "dist/").replace(/\.ts$/, ".js"), createHash("sha256").update(output).digest("hex")];
  }));
  const differences = artifacts.filter(artifact => compiled.get(artifact.file) !== artifact.sha256).map(artifact => artifact.file);
  const extraCompiledFiles = [...compiled.keys()].filter(file => !artifacts.some(artifact => artifact.file === file));
  return { commit, byteEquivalentJavaScript: differences.length === 0 && extraCompiledFiles.length === 0,
    differences, extraCompiledFiles };
});
// Capture after reading: refuse to bind a mixed observation across container replacement.
const finalImage = ssh(`docker inspect --format '{{.Id}} {{.Image}} {{.State.StartedAt}}' ${api}`);
if (finalImage !== `${image.containerId} ${image.imageId} ${image.startedAt}`) throw new Error("Deployment changed during audit; repeat inspection");
const report = {
  schemaVersion: "deployment-code-audit/1", recordedAt: new Date().toISOString(), target, container: api, image,
  imageRevision: imageRevision === "<no value>" || imageRevision === "" ? null : imageRevision,
  localHead: git(["rev-parse", "HEAD"]), localTypeScriptVersion: ts.version,
  method: "Compare every deployed API JavaScript file with locally transpiled tracked sources; require identical file sets and bytes.",
  scope: "API JavaScript only; excludes dashboard, image layers, dependencies, configuration, source maps and data.",
  provenanceAuthenticated: false,
  exactBuildCommitEstablished: false,
  artifacts, comparisons,
  equivalentCodeCommits: comparisons.filter(comparison => comparison.byteEquivalentJavaScript).map(comparison => comparison.commit),
  limitation: "Equivalent code across commits cannot identify which commit or dirty working tree actually built an image without provenance.",
};
const directory = new URL(`../reports/deployment-audit/${randomUUID()}/`, import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("audit.json", directory), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ target, imageId: image.imageId, imageRevision: report.imageRevision,
  artifacts: artifacts.length, equivalentCodeCommits: report.equivalentCodeCommits,
  exactBuildCommitEstablished: false, directory: directory.pathname }, null, 2));
