import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ApiError, record } from "./contracts.js";

export interface ContextFlow {
  definition: { id: string; title: string; goal: string; kind: "product" | "support"; nextStep: string; dependencies: string[]; actionGroups: string[];
    journey?: { id: string; title: string; actionIds: string[]; authRefs: string[]; externalSystems: string[] }[] };
  definitionState: "journey_defined" | "actions_mapped";
  actionIds: string[];
  pages: string[];
  permissions: string[];
  assessment: { interface: { state: string; mappedActionIds: string[]; unmappedActionIds: string[] }; publication: "not_observed"; execution: "not_observed" };
}
export interface ContextAction {
  id: string; flow: string; status: "implemented" | "blocked"; operation: { method: string; path: string };
  permissions?: string[]; preconditions?: string[]; recovery?: string; sources?: string[];
  input?: { body?: { source: string; type: string } | null };
  response?: { action?: string };
  ui?: { pages: string[]; bff?: { method: string; path: string } | null; gap?: string | null };
}
export interface ProductContext {
  schemaVersion: "erp-product-context/1";
  product: "erp";
  contentSha256: string;
  source: { repository: "avilaops/erp-next"; commit: string; dirty: boolean };
  selection: { targetFlow: string | null; includedFlows: string[] };
  flows: ContextFlow[];
  actions: ContextAction[];
  authActions: { path: string; method: string; action: string; recovery: string }[];
  pendingFlows: { id: string; title: string; status: "needs_definition"; openDecisions: string[] }[];
  limits: string[];
}
export type PublicationObservation = { state: "not_observed" } | {
  state: "version_observed"; origin: "https://erp.avilaops.com"; servedCommit: string; observedAt: string;
};
export interface ContextReceipt {
  requestId: string;
  revision: number;
  contentSha256: string;
  sourceCommit: string;
  sourceDirty: boolean;
  importedAt: string;
  publication: PublicationObservation;
  execution: "not_observed";
}
interface Catalog { revision: number; imports: ContextReceipt[] }

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const name of ["product-flow-definitions.schema.json", "product-context.schema.json"]) {
  ajv.addSchema(JSON.parse(await readFile(new URL(`../../schemas/erp/${name}`, import.meta.url), "utf8")));
}
const validateSchema = ajv.compile<ProductContext>({ $ref: "https://erp.avilaops.com/schemas/product-context-1.json" });
const missing = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
export const contextHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function canonicalContextJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, sort(entry)])) : item;
  return JSON.stringify(sort(value), null, 2) + "\n";
}
function invalid(): never { throw new ApiError(400, "INVALID_PRODUCT_CONTEXT", "Contexto ERP inválido, incompleto ou com hash divergente."); }
export function parseProductContext(value: unknown): ProductContext {
  if (!validateSchema(value)) invalid();
  const { contentSha256, ...payload } = value;
  if (contextHash(canonicalContextJson(payload)) !== contentSha256 || value.selection.targetFlow !== null) invalid();
  const ids = value.flows.map(flow => flow.definition.id);
  if (new Set(ids).size !== ids.length || canonicalContextJson([...ids].sort()) !== canonicalContextJson([...value.selection.includedFlows].sort())) invalid();
  const groups = new Map<string, string>();
  for (const flow of value.flows) {
    if (flow.definition.dependencies.some(id => !ids.includes(id))) invalid();
    for (const group of flow.definition.actionGroups) { if (groups.has(group)) invalid(); groups.set(group, flow.definition.id); }
  }
  const actions = new Set<string>();
  for (const action of value.actions) {
    for (const entries of [action.permissions, action.preconditions, action.sources]) if (entries !== undefined && (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string"))) invalid();
    if (action.response !== undefined && (!action.response || typeof action.response !== "object" || (action.response.action !== undefined && typeof action.response.action !== "string"))) invalid();
    if (action.ui !== undefined) {
      if (!action.ui || !Array.isArray(action.ui.pages) || action.ui.pages.some(page => typeof page !== "string")
          || (action.ui.gap != null && typeof action.ui.gap !== "string")
          || (action.ui.bff != null && (typeof action.ui.bff !== "object" || typeof action.ui.bff.method !== "string" || typeof action.ui.bff.path !== "string"))) invalid();
    }
    if (action.input !== undefined && (!action.input || typeof action.input !== "object"
        || (action.input.body != null && (typeof action.input.body !== "object" || typeof action.input.body.type !== "string" || typeof action.input.body.source !== "string")))) invalid();
    if (actions.has(action.id) || !groups.has(action.flow)) invalid();
    actions.add(action.id);
    const owner = value.flows.find(flow => flow.definition.id === groups.get(action.flow))!;
    if (!owner.actionIds.includes(action.id)) invalid();
  }
  for (const flow of value.flows) if (flow.actionIds.some(id => !actions.has(id) || groups.get(value.actions.find(action => action.id === id)!.flow) !== flow.definition.id)) invalid();
  return value;
}
export function contextRequestId(digest: string, confirmPublication: boolean): string {
  return contextHash(canonicalContextJson({ schemaVersion: "erp-context-import/1", contentSha256: digest, confirmPublication }));
}
async function observeProduction(commit: string): Promise<PublicationObservation> {
  try {
    const response = await fetch("https://erp.avilaops.com/api/health", { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("health unavailable");
    const health = await response.json() as { application?: unknown; commit?: unknown; ok?: unknown };
    if (health.ok !== true || health.application !== "erp-next" || health.commit !== commit) throw new Error("version mismatch");
    return { state: "version_observed", origin: "https://erp.avilaops.com", servedCommit: commit, observedAt: new Date().toISOString() };
  } catch { throw new ApiError(409, "PUBLICATION_NOT_CONFIRMED", "O laboratório não confirmou essa versão no health do ERP. A captura anterior foi preservada."); }
}

/** One API process owns the volume. Snapshots precede the atomic receipt catalog. */
export class ProductContextStore {
  readonly #directory: string;
  readonly #observe: (commit: string) => Promise<PublicationObservation>;
  #writes: Promise<unknown> = Promise.resolve();
  constructor(directory: string, observe = observeProduction) { this.#directory = path.join(path.resolve(directory), "product-contexts", "erp"); this.#observe = observe; }
  async #catalog(): Promise<Catalog> {
    try { return JSON.parse(await readFile(path.join(this.#directory, "catalog.json"), "utf8")) as Catalog; }
    catch (error) { if (missing(error)) return { revision: 0, imports: [] }; throw error; }
  }
  async state() {
    await this.#writes;
    const catalog = await this.#catalog();
    return { product: "erp", revision: catalog.revision, latest: catalog.imports.at(-1) ?? null,
      latestPublication: catalog.imports.findLast(item => item.publication.state === "version_observed") ?? null };
  }
  async receipt(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(400, "INVALID_INPUT", "requestId inválido.");
    await this.#writes;
    const receipt = (await this.#catalog()).imports.find(item => item.requestId === id);
    if (!receipt) throw new ApiError(404, "CONTEXT_IMPORT_NOT_FOUND", "Importação não encontrada.");
    return receipt;
  }
  async view(options: { digest?: string; mode?: string; flow?: string; indexOnly?: boolean } = {}) {
    if (options.mode !== undefined && !["latest", "published"].includes(options.mode)) throw new ApiError(400, "INVALID_INPUT", "Modo inválido.");
    if (options.digest !== undefined && !/^[a-f0-9]{64}$/.test(options.digest)) throw new ApiError(400, "INVALID_INPUT", "SHA-256 inválido.");
    if (options.flow !== undefined && !/^[a-z][a-z0-9_-]{0,99}$/.test(options.flow)) throw new ApiError(400, "INVALID_INPUT", "Funcionalidade inválida.");
    if (options.digest && options.mode === "published") throw new ApiError(400, "INVALID_INPUT", "Escolha o hash ou a última publicação observada.");
    await this.#writes;
    const catalog = await this.#catalog();
    const published = catalog.imports.findLast(item => item.publication.state === "version_observed") ?? null;
    const selected = options.digest ? catalog.imports.findLast(item => item.contentSha256 === options.digest)
      : options.mode === "published" ? published : catalog.imports.at(-1);
    if (!selected && (options.digest || options.mode === "published")) throw new ApiError(404, "CONTEXT_NOT_FOUND", "Não existe captura para essa seleção; nenhuma versão ativa foi presumida.");
    const seen = new Set<string>();
    const captures = [...catalog.imports].reverse().filter(item => { if (seen.has(item.contentSha256)) return false; seen.add(item.contentSha256); return true; }).slice(0, 50);
    if (!selected) return { schemaVersion: "erp-product-flow-view/1" as const, revision: catalog.revision, capture: null, captures, latestPublication: published, flows: [], actions: [], pendingFlows: [], edges: [], limits: ["Nenhum contexto importado."] };
    const context = await this.snapshot(selected.contentSha256);
    const included = new Set<string>();
    const include = (id: string) => { if (included.has(id)) return; const flow = context.flows.find(item => item.definition.id === id); if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "Funcionalidade não encontrada nessa captura."); included.add(id); flow.definition.dependencies.forEach(include); };
    if (options.flow) include(options.flow); else context.flows.forEach(flow => included.add(flow.definition.id));
    const flows = context.flows.filter(flow => included.has(flow.definition.id));
    const groups = new Set(flows.flatMap(flow => flow.definition.actionGroups));
    const actions = context.actions.filter(action => groups.has(action.flow));
    const summaries = flows.map(flow => {
      const owned = actions.filter(action => flow.actionIds.includes(action.id));
      return { ...flow, counts: { actions: owned.length, implemented: owned.filter(action => action.status === "implemented").length,
        blocked: owned.filter(action => action.status === "blocked").length,
        routesMapped: flow.assessment.interface.mappedActionIds.length } };
    });
    const result = { schemaVersion: "erp-product-flow-view/1" as const, revision: catalog.revision, capture: selected, captures, latestPublication: published,
      selection: { targetFlow: options.flow ?? null, includedFlows: flows.map(flow => flow.definition.id) },
      source: context.source, authActions: options.indexOnly ? [] : context.authActions,
      flows: summaries, actions: options.indexOnly ? [] : actions, pendingFlows: context.pendingFlows,
      edges: flows.flatMap(flow => flow.definition.dependencies.map(id => ({ from: flow.definition.id, to: id, relation: "depends_on" as const }))),
      limits: context.limits,
    };
    return result;
  }
  async snapshot(digest: string): Promise<ProductContext> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new ApiError(400, "INVALID_INPUT", "SHA-256 inválido.");
    await this.#writes;
    // Uncommitted snapshot files left by an interrupted write are not imports.
    const catalog = await this.#catalog();
    if (!catalog.imports.some(item => item.contentSha256 === digest)) throw new ApiError(404, "CONTEXT_NOT_FOUND", "Captura não importada.");
    try {
      const context = parseProductContext(JSON.parse(await readFile(path.join(this.#directory, digest + ".json"), "utf8")));
      if (context.contentSha256 !== digest) throw new Error("digest mismatch");
      return context;
    } catch { throw new ApiError(500, "CONTEXT_STORAGE_INVALID", "A captura armazenada não passou na conferência de integridade."); }
  }
  save(input: unknown, expectedRevision: number) {
    const request = record(input, "context import");
    if (Object.keys(request).length !== 2 || typeof request.confirmPublication !== "boolean") invalid();
    const context = parseProductContext(structuredClone(request.context));
    const confirm = request.confirmPublication;
    const bytes = canonicalContextJson(context);
    const requestId = contextRequestId(context.contentSha256, confirm);
    const operation = this.#writes.then(async () => {
      const catalog = await this.#catalog();
      const existing = catalog.imports.find(item => item.requestId === requestId);
      if (existing) {
        const stored = await readFile(path.join(this.#directory, context.contentSha256 + ".json"), "utf8");
        if (stored !== bytes) throw new ApiError(409, "CONTEXT_CONTENT_CONFLICT", "A captura existente diverge e foi preservada.");
        return { reused: true, currentRevision: catalog.revision, receipt: existing };
      }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || catalog.revision !== expectedRevision) throw new ApiError(412, "REVISION_CONFLICT", "O contexto mudou. Confira o recibo antes de repetir a importação.");
      if (catalog.imports.length >= 5000) throw new ApiError(409, "CONTEXT_HISTORY_LIMIT", "O histórico atingiu o limite operacional; preserve-o antes de ampliar a capacidade.");
      if (confirm && context.source.dirty) throw new ApiError(409, "DIRTY_PUBLICATION", "Um checkout alterado não pode ser confirmado como a versão publicada.");
      const publication = confirm ? await this.#observe(context.source.commit) : { state: "not_observed" as const };
      const receipt: ContextReceipt = { requestId, revision: catalog.revision + 1, contentSha256: context.contentSha256,
        sourceCommit: context.source.commit, sourceDirty: context.source.dirty, importedAt: new Date().toISOString(), publication, execution: "not_observed" };
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      const snapshot = path.join(this.#directory, context.contentSha256 + ".json");
      try { await writeFile(snapshot, bytes, { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
        if (await readFile(snapshot, "utf8") !== bytes) throw new ApiError(409, "CONTEXT_CONTENT_CONFLICT", "A captura existente diverge e foi preservada.");
      }
      const target = path.join(this.#directory, "catalog.json"), temporary = target + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, canonicalContextJson({ revision: receipt.revision, imports: [...catalog.imports, receipt] }), { flag: "wx", mode: 0o600 });
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
      return { reused: false, currentRevision: receipt.revision, receipt };
    });
    this.#writes = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
