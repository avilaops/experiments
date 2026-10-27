import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execute = promisify(execFile);
const dashboard = fileURLToPath(new URL("../", import.meta.url));

test("consecutive exports remove revoked evidence and stale files from the entire public tree", async () => {
  // Keep the fixture beside the dashboard so build dependencies resolve normally.
  const workspace = await mkdtemp(path.join(dashboard, ".export-test-"));
  const directory = path.join(workspace, "dashboard");
  try {
    await mkdir(directory);
    await mkdir(path.join(workspace, "src", "lab"), { recursive: true });
    await cp(path.join(dashboard, "..", "src", "lab", "policy-contracts.ts"), path.join(workspace, "src", "lab", "policy-contracts.ts"));
    for (const entry of ["build.mjs", "public-export.mjs", "src", "content", "evidence", "evidence.allowlist.json"]) {
      await cp(path.join(dashboard, entry), path.join(directory, entry), { recursive: true });
    }
    const allowed = JSON.parse(await readFile(path.join(directory, "evidence.allowlist.json")));
    await writeFile(path.join(directory, "evidence", "revoked.json"), '{"synthetic":true}\n');
    await writeFile(path.join(directory, "evidence.allowlist.json"), JSON.stringify([...allowed, "revoked.json"]));
    const build = () => execute(process.execPath, [path.join(directory, "build.mjs")], { timeout: 30000 });
    await build();
    assert.ok((await readdir(path.join(directory, "public/data"))).includes("revoked.json"));
    await writeFile(path.join(directory, "public", ".env"), "SYNTHETIC_STALE_SENTINEL");
    await mkdir(path.join(directory, "public", "legacy"));
    await writeFile(path.join(directory, "public", "legacy", "ghost.txt"), "stale");
    await writeFile(path.join(directory, "evidence.allowlist.json"), JSON.stringify(allowed));
    await build();
    assert.deepEqual((await readdir(path.join(directory, "public/data"))).sort(), [...allowed].sort());
    assert.deepEqual((await readdir(path.join(directory, "public"))).sort(), ["data", "index.html", "manifest.json", "style.css"]);
    const manifest = JSON.parse(await readFile(path.join(directory, "public/manifest.json")));
    assert.deepEqual(manifest.artifacts.map(item => item.file).sort(), [...allowed].sort());

    const html = await readFile(path.join(directory, "public/index.html"), "utf8");
    const metadata = await readFile(path.join(directory, "public/manifest.json"), "utf8");
    assert.ok(!html.includes("revoked.json"));
    await build();
    assert.equal(await readFile(path.join(directory, "public/index.html"), "utf8"), html);
    assert.equal(await readFile(path.join(directory, "public/manifest.json"), "utf8"), metadata);

    // A bad selection must fail without replacing the last complete export.
    await writeFile(path.join(directory, "evidence.allowlist.json"), JSON.stringify([...allowed, "../private.json"]));
    await assert.rejects(build(), /Invalid allowlist/);
    assert.equal(await readFile(path.join(directory, "public/index.html"), "utf8"), html);
    assert.equal(await readFile(path.join(directory, "public/manifest.json"), "utf8"), metadata);
    assert.deepEqual((await readdir(directory)).filter(name => name.startsWith(".public-")), []);
  } finally {
    // directory comes directly from mkdtemp beneath this dashboard's root.
    assert.equal(path.dirname(path.resolve(workspace)), path.resolve(dashboard));
    await rm(workspace, { recursive: true, force: true });
  }
});
