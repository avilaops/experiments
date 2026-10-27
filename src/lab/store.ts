import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { compareExperiments } from "../comparison.js";
import { numericTolerance, numberRange } from "../evaluators.js";
import { fingerprint, snapshot } from "../json.js";
import { runExperiment } from "../runner.js";
import type { Experiment } from "../types.js";
import { ApiError, calculate, DEFAULT_DRAFT, parseDraft, runId, type CalculationInput, type StoredRun, type Suite, type SuiteDraft } from "./contracts.js";

function notFound(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function runSummary(run: StoredRun) {
  return {
    id: run.id, createdAt: run.createdAt, mode: run.mode, suiteRevision: run.suite.revision,
    baseline: run.baseline.summary, candidate: run.candidate.summary, comparison: run.comparison,
  };
}

type RunSummary = ReturnType<typeof runSummary>;
const newestFirst = (left: RunSummary, right: RunSummary) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);

export class LabStore {
  readonly #directory: string;
  #updates: Promise<unknown> = Promise.resolve();
  #running = false;
  #runIndex: RunSummary[] = [];

  constructor(directory: string) {
    this.#directory = path.resolve(directory);
  }

  async #write(filename: string, value: unknown) {
    const target = path.join(this.#directory, filename);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error: unknown) => { if (!notFound(error)) throw error; });
    }
  }

  async initialize(seed: SuiteDraft = DEFAULT_DRAFT): Promise<void> {
    await mkdir(path.join(this.#directory, "runs"), { recursive: true });
    try {
      await this.#readSuite();
    } catch (error) {
      if (!notFound(error)) throw error;
      const draft = parseDraft(seed);
      await this.#write("suite.json", {
        revision: 1, hypothesis: draft.hypothesis, settings: draft.settings,
        dataset: { id: "lab-calculation", version: "1", split: "development", cases: draft.cases },
      });
    }
    await this.#initializeRunIndex();
  }

  async #initializeRunIndex() {
    let cached: RunSummary[] = [];
    try {
      const index = JSON.parse(await readFile(path.join(this.#directory, "runs-index.json"), "utf8"));
      if (index?.schemaVersion === "1" && Array.isArray(index.items) && index.items.every((item: RunSummary) =>
        item && typeof item.id === "string" && typeof item.createdAt === "string" && item.baseline && item.candidate)) {
        cached = index.items;
      }
    } catch (error) {
      if (!notFound(error) && !(error instanceof SyntaxError)) throw error;
    }
    const summaries = new Map(cached.map(item => [item.id, item]));
    const files = (await readdir(path.join(this.#directory, "runs"))).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name));
    const restored: RunSummary[] = [];
    // Migrate older volumes and recover runs committed before an interrupted index
    // write, loading one complete report at a time rather than the entire history.
    for (const file of files) {
      const id = file.slice(0, -5);
      restored.push(summaries.get(id) ?? runSummary(await this.run(id)));
    }
    this.#runIndex = restored.sort(newestFirst);
    await this.#write("runs-index.json", { schemaVersion: "1", items: this.#runIndex });
  }

  async #readSuite(): Promise<Suite> {
    return JSON.parse(await readFile(path.join(this.#directory, "suite.json"), "utf8")) as Suite;
  }

  async suite(): Promise<Suite> {
    await this.#updates;
    return this.#readSuite();
  }

  update(draft: SuiteDraft, revision: number): Promise<Suite> {
    const operation = this.#updates.then(async () => {
      const current = await this.#readSuite();
      if (current.revision !== revision) throw new ApiError(412, "REVISION_CONFLICT", "A suíte mudou. Recarregue os dados antes de salvar.");
      const normalized = parseDraft(draft);
      const next: Suite = {
        revision: current.revision + 1,
        hypothesis: normalized.hypothesis,
        settings: normalized.settings,
        dataset: { ...current.dataset, version: String(current.revision + 1), cases: normalized.cases },
      };
      await this.#write("suite.json", next);
      return next;
    });
    this.#updates = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async execute(revision: number): Promise<StoredRun> {
    if (this.#running) throw new ApiError(429, "LAB_BUSY", "Outra execução está em andamento.");
    this.#running = true;
    try {
      const suite = snapshot(await this.suite());
      if (suite.revision !== revision) throw new ApiError(409, "REVISION_CONFLICT", "A suíte mudou. Recarregue antes de executar.");
      const settings = suite.settings;
      const experiment = (version: string): Experiment<CalculationInput, number> => ({
        id: "lab-calculation", version: "1", hypothesis: suite.hypothesis,
        dataset: suite.dataset,
        variant: { id: "calculator", version, codeVersion: `sha256:${fingerprint(calculate.toString())}` },
        evaluators: [
          numericTolerance<CalculationInput, number>({ absoluteTolerance: settings.absoluteTolerance, relativeTolerance: settings.relativeTolerance }),
          numberRange<CalculationInput, number>(settings),
        ],
      });
      const options = { repetitions: settings.repetitions };
      const baseline = await runExperiment(experiment("rounded"), (input) => ({ output: Math.round(calculate(input)) }), options);
      const candidate = await runExperiment(experiment("fractional"), (input) => ({ output: calculate(input) }), options);
      const result: StoredRun = {
        id: randomUUID(), createdAt: new Date().toISOString(), mode: "deterministic-local",
        suite, baseline, candidate, comparison: compareExperiments(baseline, candidate),
      };
      await this.#write(path.join("runs", `${result.id}.json`), result);
      this.#runIndex.push(snapshot(runSummary(result)));
      this.#runIndex.sort(newestFirst);
      await this.#write("runs-index.json", { schemaVersion: "1", items: this.#runIndex });
      return result;
    } finally {
      this.#running = false;
    }
  }

  async run(id: string): Promise<StoredRun> {
    const safeId = runId(id);
    try {
      return JSON.parse(await readFile(path.join(this.#directory, "runs", `${safeId}.json`), "utf8")) as StoredRun;
    } catch (error) {
      if (notFound(error)) throw new ApiError(404, "RUN_NOT_FOUND", "Execução não encontrada.");
      throw error;
    }
  }

  async runs(limit: number, offset: number) {
    return {
      total: this.#runIndex.length,
      items: snapshot(this.#runIndex.slice(offset, offset + limit)),
    };
  }
}
