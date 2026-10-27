import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { publishPublicExport } from "../public-export.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-public-export-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-public-export-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function populate(output, names) {
  await mkdir(path.join(output, "data"), { recursive: true });
  await writeFile(path.join(output, "index.html"), "<!doctype html><title>Synthetic evidence</title>");
  await writeFile(path.join(output, "style.css"), "body { color: #0f766e; }");
  const artifacts = [];
  for (const file of names) {
    const bytes = Buffer.from(JSON.stringify({ file, synthetic: true }));
    await writeFile(path.join(output, "data", file), bytes);
    artifacts.push({ file, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(path.join(output, "manifest.json"), JSON.stringify({ artifacts }));
}

test("rebuild removes sentinels at any depth and physically removes deselected evidence", async t => {
  const root = await fixture(t);
  await publishPublicExport(root, ["retained.json", "removed.json"], output => populate(output, ["retained.json", "removed.json"]));
  await mkdir(path.join(root, "public", "old", "nested"), { recursive: true });
  await writeFile(path.join(root, "public", "old", "nested", "sentinel.txt"), "not public");
  await writeFile(path.join(root, "public", "data", "sentinel.json"), "{}");
  await writeFile(path.join(root, "public", ".env"), "HARMLESS_SENTINEL=true");
  await publishPublicExport(root, ["retained.json"], output => populate(output, ["retained.json"]));
  assert.deepEqual((await readdir(path.join(root, "public"))).sort(), ["data", "index.html", "manifest.json", "style.css"]);
  assert.deepEqual(await readdir(path.join(root, "public", "data")), ["retained.json"]);
  const before = await readFile(path.join(root, "public", "manifest.json"), "utf8");
  await publishPublicExport(root, ["retained.json"], output => populate(output, ["retained.json"]));
  assert.equal(await readFile(path.join(root, "public", "manifest.json"), "utf8"), before);
  assert.deepEqual(await readdir(root), ["public"]);
});

test("rendering failures preserve the previous export and release the build lock", async t => {
  const root = await fixture(t);
  await publishPublicExport(root, ["retained.json"], output => populate(output, ["retained.json"]));
  await assert.rejects(publishPublicExport(root, [], async output => {
    await mkdir(output);
    throw new Error("MDX rendering failed");
  }), /MDX rendering failed/);
  assert.deepEqual(await readdir(path.join(root, "public", "data")), ["retained.json"]);
  assert.deepEqual(await readdir(root), ["public"]);
});

test("unexpected files, corrupt evidence and duplicate selections cannot replace the export", async t => {
  const root = await fixture(t);
  for (const kind of ["extra-root", "extra-data", "corrupt", "duplicate"]) {
    const allowed = kind === "duplicate" ? ["retained.json", "retained.json"] : ["retained.json"];
    await assert.rejects(publishPublicExport(root, allowed, async output => {
      await populate(output, ["retained.json"]);
      if (kind === "extra-root") await writeFile(path.join(output, "log.txt"), "not approved");
      if (kind === "extra-data") await writeFile(path.join(output, "data", "extra.json"), "{}");
      if (kind === "corrupt") await writeFile(path.join(output, "data", "retained.json"), "{}");
    }));
    assert.deepEqual(await readdir(root), []);
  }
});

test("concurrent exporters cannot promote competing directories", async t => {
  const root = await fixture(t);
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const first = publishPublicExport(root, [], async output => {
    entered();
    await gate;
    await populate(output, []);
  });
  await ready;
  try {
    await assert.rejects(publishPublicExport(root, [], output => populate(output, [])), { code: "EEXIST" });
  } finally { release(); await first; }
  assert.deepEqual(await readdir(root), ["public"]);
});
