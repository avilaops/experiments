import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareExperiments, exactMatch, numberRange, numericTolerance, pathFidelity, runExperiment } from "../dist/index.js";
import { LabStore } from "../dist/lab/store.js";

test("native evaluator identity, criteria and functions cannot diverge from recorded provenance", async () => {
  const tolerance = numericTolerance({ absoluteTolerance: 0 });
  const range = numberRange({ minimum: 0, maximum: 1 });
  for (const evaluator of [exactMatch(), tolerance, range, pathFidelity({ requiredNodes: ["check"] })]) {
    assert.throws(() => { evaluator.id = "different"; }, TypeError);
    assert.throws(() => { evaluator.threshold = 0; }, TypeError);
    assert.throws(() => { evaluator.evaluate = () => ({ score: 1, reason: "Replaced" }); }, TypeError);
    assert.throws(() => { evaluator.parameters = {}; }, TypeError);
  }
  assert.throws(() => { tolerance.parameters.absoluteTolerance = 10; }, TypeError);
  assert.throws(() => { range.parameters.maximum = 10; }, TypeError);
  const experiment = evaluator => ({
    id: "provenance", version: "1", hypothesis: "Comparisons require the criteria actually used.",
    dataset: { id: "numbers", version: "1", split: "evaluation", cases: [{ id: "one", input: null, expected: 1 }] },
    variant: { id: "constant", version: "1", codeVersion: "test" }, evaluators: [evaluator],
  });
  const strict = await runExperiment(experiment(tolerance), () => ({ output: 2 }));
  const loose = await runExperiment(experiment(numericTolerance({ absoluteTolerance: 10 })), () => ({ output: 2 }));
  assert.equal(strict.summary.verdict, "failed");
  assert.equal(strict.evaluators[0].parameters.absoluteTolerance, 0);
  assert.equal(loose.summary.verdict, "passed");
  assert.equal(compareExperiments(strict, loose).comparable, false);
});

async function storeFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "avila-index-test-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith("avila-index-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const store = new LabStore(directory);
  await store.initialize();
  return { directory, store };
}

test("history pages use summaries without opening full runs and cannot mutate the index", async t => {
  const { store } = await storeFixture(t);
  const runs = [];
  for (let index = 0; index < 5; index++) runs.push(await store.execute(1));
  store.run = async () => { throw new Error("History must not read complete runs"); };
  const expected = runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const page = await store.runs(2, 1);
  assert.equal(page.total, 5);
  assert.deepEqual(page.items.map(item => item.id), expected.slice(1, 3).map(item => item.id));
  page.items[0].candidate.passed = -1;
  assert.notEqual((await store.runs(2, 1)).items[0].candidate.passed, -1);
  assert.deepEqual((await store.runs(2, 20)).items, []);
});

test("startup migrates old volumes sequentially and recovers a run missing from the index", async t => {
  const { directory, store } = await storeFixture(t);
  const first = await store.execute(1);
  const second = await store.execute(1);
  await unlink(path.join(directory, "runs-index.json"));
  const migrated = new LabStore(directory);
  let active = 0;
  const readRun = migrated.run.bind(migrated);
  migrated.run = async id => {
    assert.equal(++active, 1);
    try { return await readRun(id); } finally { active--; }
  };
  await migrated.initialize();
  assert.equal((await migrated.runs(10, 0)).total, 2);
  const indexFile = path.join(directory, "runs-index.json");
  const index = JSON.parse(await readFile(indexFile, "utf8"));
  index.items = index.items.filter(item => item.id === first.id);
  await writeFile(indexFile, JSON.stringify(index));
  const restarted = new LabStore(directory);
  const loaded = [];
  const loadRun = restarted.run.bind(restarted);
  restarted.run = async id => { loaded.push(id); return loadRun(id); };
  await restarted.initialize();
  assert.deepEqual(loaded, [second.id]);
  assert.equal((await restarted.runs(10, 0)).total, 2);
  assert.deepEqual(await restarted.run(first.id), JSON.parse(JSON.stringify(first)));
});

test("a damaged derived index is rebuilt without changing original evidence", async t => {
  const { directory, store } = await storeFixture(t);
  const run = await store.execute(1);
  const before = await readFile(path.join(directory, "runs", run.id + ".json"));
  await writeFile(path.join(directory, "runs-index.json"), "invalid JSON");
  const restarted = new LabStore(directory);
  await restarted.initialize();
  assert.equal((await restarted.runs(1, 0)).items[0].id, run.id);
  assert.deepEqual(await readFile(path.join(directory, "runs", run.id + ".json")), before);
});
