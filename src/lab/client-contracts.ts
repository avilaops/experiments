import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError, record } from "./contracts.js";
import { CONTRACT_CYCLES, CONTRACT_PRODUCTS, CONTRACT_STATUSES } from "./client-contract-types.js";
import type { ClientContract, ClientContractCatalog, ClientContractChange, ClientContractDraft, ClientContractHistory, ClientContractResult, ClientContractSave } from "./client-contract-types.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FIELDS = ["code", "title", "clientName", "clientReference", "product", "status", "startDate", "endDate", "amount", "billingCycle", "notes"];
const MAX_CONTRACTS = 500, MAX_CHANGES = 5000;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
function invalid(message: string): never { throw new ApiError(400, "INVALID_INPUT", message); }
function fields(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) invalid("Campos do contrato inválidos.");
}
function text(value: unknown, name: string, max: number, optional = false): string {
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) invalid(`${name}: texto ${optional ? "de até" : "obrigatório, com até"} ${max} caracteres.`);
  return value.trim();
}
function date(value: unknown, name: string, optional = false): string {
  const result = text(value, name, 10, optional);
  if (optional && result === "") return result;
  const timestamp = Date.parse(result + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result < "0001-01-01" || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== result) invalid(`${name}: use uma data válida no formato AAAA-MM-DD.`);
  return result;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid("Identificador do contrato inválido.");
  return value;
}
function natural(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid("Revisão inválida.");
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid("Data de alteração inválida.");
  return value;
}

export function parseClientContract(input: unknown): ClientContractDraft {
  const value = record(input, "contract");
  fields(value, FIELDS);
  const code = text(value.code, "Código", 60).toUpperCase();
  if (code.length > 60 || !/^[A-Z0-9][A-Z0-9./_-]*$/.test(code)) invalid("Código: use até 60 letras, números, pontos, barras, hífens ou sublinhados.");
  const product = text(value.product, "Produto", 30);
  if (!CONTRACT_PRODUCTS.some(item => item.id === product)) invalid("Produto inválido.");
  if (typeof value.status !== "string" || !Object.hasOwn(CONTRACT_STATUSES, value.status)) invalid("Situação inválida.");
  if (typeof value.billingCycle !== "string" || !Object.hasOwn(CONTRACT_CYCLES, value.billingCycle)) invalid("Periodicidade inválida.");
  const startDate = date(value.startDate, "Início"), endDate = date(value.endDate, "Término", true);
  if (endDate && endDate < startDate) invalid("O término deve ser igual ou posterior ao início.");
  if (typeof value.amount !== "string" || !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(value.amount)) invalid("Valor: envie reais com duas casas decimais, entre 0.00 e 9999999999.99.");
  return { code, title: text(value.title, "Título", 200), clientName: text(value.clientName, "Cliente", 200), clientReference: text(value.clientReference, "Referência do cliente", 120, true),
    product, status: value.status as ClientContractDraft["status"], startDate, endDate, amount: value.amount, billingCycle: value.billingCycle as ClientContractDraft["billingCycle"], notes: text(value.notes, "Observações", 4000, true) };
}

function parseSave(input: unknown): ClientContractSave {
  const value = record(input, "update"); fields(value, ["id", "contract", "changeNote"]);
  return { id: value.id === null ? null : id(value.id), contract: parseClientContract(value.contract), changeNote: text(value.changeNote, "Motivo da alteração", 500) };
}
function savedContract(input: unknown): ClientContract {
  const value = record(input, "contract"); fields(value, [...FIELDS, "id", "version", "createdAt", "updatedAt"]);
  const draft = Object.fromEntries(FIELDS.map(key => [key, value[key]]));
  return { ...parseClientContract(draft), id: id(value.id), version: natural(value.version, 1), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) };
}
interface State extends ClientContractCatalog { schemaVersion: "client-contracts/1"; history: ClientContractChange[] }

/** One writer process per data directory, matching the laboratory deployment. */
export class ClientContractStore {
  readonly #file: string;
  #writes: Promise<unknown> = Promise.resolve();
  constructor(directory: string) { this.#file = path.join(path.resolve(directory), "client-contracts.json"); }

  async #read(): Promise<State> {
    let bytes: string;
    try { bytes = await readFile(this.#file, "utf8"); }
    catch (error) { if (missing(error)) return { schemaVersion: "client-contracts/1", revision: 0, contracts: [], history: [] }; throw error; }
    try {
      const value = record(JSON.parse(bytes), "state"); fields(value, ["schemaVersion", "revision", "contracts", "history"]);
      const revision = natural(value.revision);
      if (value.schemaVersion !== "client-contracts/1" || !Array.isArray(value.contracts) || !Array.isArray(value.history)
        || value.contracts.length > MAX_CONTRACTS || value.history.length !== revision || revision > MAX_CHANGES) invalid("Registro inválido.");
      const contracts = value.contracts.map(savedContract), history: ClientContractChange[] = [];
      const latest = new Map<string, ClientContract>();
      for (const [index, entry] of value.history.entries()) {
        const row = record(entry, "change"); fields(row, ["revision", "changeNote", "contract"]);
        const contract = savedContract(row.contract), previous = latest.get(contract.id);
        if (row.revision !== index + 1 || contract.version !== (previous?.version ?? 0) + 1
          || (previous && contract.createdAt !== previous.createdAt)) invalid("Histórico inválido.");
        history.push({ revision: index + 1, changeNote: text(row.changeNote, "Motivo", 500), contract });
        latest.set(contract.id, contract);
      }
      if (new Set(contracts.map(item => item.id)).size !== contracts.length || new Set(contracts.map(item => item.code)).size !== contracts.length
        || latest.size !== contracts.length || contracts.some(item => JSON.stringify(latest.get(item.id)) !== JSON.stringify(item))) invalid("Histórico divergente.");
      return { schemaVersion: "client-contracts/1", revision, contracts, history };
    } catch { throw new ApiError(500, "CONTRACT_STORAGE_INVALID", "O registro de contratos precisa de revisão técnica. Nenhum dado foi substituído."); }
  }

  async catalog(): Promise<ClientContractCatalog> {
    await this.#writes;
    const { revision, contracts } = await this.#read();
    return { revision, contracts };
  }

  async history(contractId: string, limit: number, offset: number): Promise<ClientContractHistory> {
    id(contractId); natural(limit, 1); natural(offset);
    if (limit > 100) invalid("O limite máximo é 100.");
    await this.#writes;
    const state = await this.#read();
    if (!state.contracts.some(item => item.id === contractId)) throw new ApiError(404, "CONTRACT_NOT_FOUND", "Contrato não encontrado.");
    const items = state.history.filter(item => item.contract.id === contractId).reverse();
    return { total: items.length, limit, offset, items: items.slice(offset, offset + limit) };
  }

  save(input: unknown, revision: number): Promise<ClientContractResult> {
    const update = parseSave(input); natural(revision);
    const operation = this.#writes.then(async () => {
      const state = await this.#read();
      if (state.revision !== revision) throw new ApiError(412, "REVISION_CONFLICT", "Outro contrato foi salvo. Sua edição foi preservada nesta tela. Copie os campos que deseja manter, cancele e recarregue o cadastro antes de editar novamente.");
      const previous = update.id === null ? undefined : state.contracts.find(item => item.id === update.id);
      if (update.id !== null && !previous) throw new ApiError(404, "CONTRACT_NOT_FOUND", "Contrato não encontrado.");
      if (state.contracts.some(item => item.code === update.contract.code && item.id !== update.id)) throw new ApiError(409, "CONTRACT_CODE_EXISTS", "Este código já pertence a outro contrato. Use um código diferente.");
      if ((!previous && state.contracts.length >= MAX_CONTRACTS) || state.revision >= MAX_CHANGES) throw new ApiError(409, "CONTRACT_CAPACITY", "O limite de registros do laboratório foi atingido. Solicite uma revisão técnica.");
      const now = new Date().toISOString();
      const contract: ClientContract = { ...update.contract, id: previous?.id ?? randomUUID(), version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
      const contracts = previous ? state.contracts.map(item => item.id === contract.id ? contract : item) : [...state.contracts, contract];
      const next: State = { schemaVersion: "client-contracts/1", revision: revision + 1, contracts, history: [...state.history, { revision: revision + 1, changeNote: update.changeNote, contract }] };
      await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
      const temporary = this.#file + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, JSON.stringify(next), { flag: "wx", mode: 0o600 });
        await rename(temporary, this.#file);
      } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
      return { catalog: { revision: next.revision, contracts }, contract };
    });
    this.#writes = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
