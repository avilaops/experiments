import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ApiError, record } from "./contracts.js";
import { canonicalJson } from "../json.js";

import { PRODUCTS, POLICY_STATES, POLICY_CATEGORIES, SOURCE_KINDS, type PolicyDraft, type Policy, type PolicyCatalog, type PolicyImportPreview, type PolicyImportResult } from "./policy-contracts.js";

function invalid(message: string): never { throw new ApiError(400, "INVALID_POLICY", message); }
function text(value: unknown, name: string, maximum: number, optional = false): string {
  if (typeof value !== "string" || value.length > maximum || (!optional && !value.trim())) invalid(`${name}: texto obrigatório, até ${maximum} caracteres.`);
  return value.trim();
}
function exact(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).length !== names.length || names.some(name => !(name in value))) invalid(`Campos esperados: ${names.join(", ")}.`);
}
function option<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${name} inválido.`);
  return value as T;
}

export function parsePolicy(value: unknown): PolicyDraft {
  const input = record(value, "policy");
  exact(input, ["id", "product", "title", "category", "state", "rule", "owner", "enforcement", "verificationDate", "sources"]);
  const id = text(input.id, "Identificador", 80);
  if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(id)) invalid("Use um identificador como ERP-ACCESS-001.");
  if (!Array.isArray(input.sources) || input.sources.length > 20) invalid("Informe até 20 referências.");
  const sources = Array.from(input.sources, source => {
    const item = record(source, "source");
    exact(item, ["kind", "location", "note"]);
    return {
      kind: option(item.kind, Object.keys(SOURCE_KINDS) as (keyof typeof SOURCE_KINDS)[], "Tipo de referência"),
      location: text(item.location, "Local da referência", 2000), note: text(item.note, "Nota", 2000, true),
    };
  });
  const state = option(input.state, Object.keys(POLICY_STATES) as (keyof typeof POLICY_STATES)[], "Situação");
  const verificationDate = text(input.verificationDate, "Data de verificação", 10, true);
  if (verificationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(verificationDate) ||
      !Number.isFinite(Date.parse(verificationDate)) || new Date(verificationDate).toISOString().slice(0, 10) !== verificationDate ||
      verificationDate > new Date().toISOString().slice(0, 10))) invalid("A data de verificação deve ser válida e não futura.");
  const enforcement = text(input.enforcement, "Onde é aplicada", 4000, true);
  if (state === "documented" && !sources.some(source => source.kind === "document")) invalid("Uma política documentada precisa indicar o documento.");
  if (["implemented", "verified"].includes(state) && (!enforcement || !sources.some(source => source.kind === "code"))) {
    invalid("Informe o local de aplicação e uma referência de código para a implementação.");
  }
  if (state === "verified" && (!verificationDate || !sources.some(source => source.kind === "test") || !sources.some(source => source.kind === "evidence"))) {
    invalid("Verificação exige data, referência de teste e evidência. O cadastro não executa o teste.");
  }
  return {
    id, product: option(input.product, PRODUCTS.map(product => product.id), "Produto"),
    title: text(input.title, "Título", 180), category: option(input.category, Object.keys(POLICY_CATEGORIES) as (keyof typeof POLICY_CATEGORIES)[], "Categoria"),
    state, rule: text(input.rule, "Regra", 8000), owner: text(input.owner, "Responsável", 160),
    enforcement, verificationDate, sources,
  };
}

const seed = (policy: PolicyDraft): PolicyDraft => parsePolicy(policy);
export function initialPolicies(): PolicyDraft[] {
  return [
    seed({ id: "AVILA-DESIGN-001", product: "shared", title: "Identidade própria e ferramentas escolhidas por finalidade", category: "integration", state: "documented",
      rule: "Construir a identidade Ávila Ops. Ferramentas e referências externas podem contribuir, mas não determinam a experiência nem obrigam todos os produtos a adotar a mesma stack. Conferir o projeto antes de recomendar migração.",
      owner: "A definir", enforcement: "Diretriz de projeto; sua adoção precisa ser conferida em cada produto.", verificationDate: "",
      sources: [{ kind: "document", location: "POLICIES.md · Origem e princípios compartilhados", note: "Registra a orientação do proprietário sobre identidade própria e discussão de ferramentas. Não afirma adoção em todos os produtos." }] }),
    seed({ id: "AVILA-ENGINEERING-001", product: "shared", title: "Conteúdo, contratos e execução têm responsabilidades explícitas", category: "execution", state: "documented",
      rule: "A documentação explica e pode demonstrar comportamentos. O contrato descreve entradas e saídas. O executor valida contexto, permissões e regras de negócio. Manter referências e evidências proporcionais ao que foi verificado.",
      owner: "A definir", enforcement: "Diretriz para documentação, contratos e implementação; não cria autorização por si só.", verificationDate: "",
      sources: [{ kind: "document", location: "POLICIES.md · Origem e princípios compartilhados", note: "Síntese registrada da discussão de engenharia, MDX, ferramentas Rust e Eve. A escolha de uma ferramenta permanece separada da política." }] }),
    seed({ id: "ERP-ACCESS-001", product: "erp", title: "Identidade central e autorização por empresa", category: "access", state: "documented",
      rule: "Auth Ávila Ops prova identidade. O ERP controla empresa, associação, papéis e permissões. Identidade válida não concede acesso automático a todas as empresas.",
      owner: "A definir", enforcement: "Arquitetura declarada; revisar a implementação e os testes por capacidade.", verificationDate: "",
      sources: [{ kind: "document", location: "D:\\Projetos\\SaaS\\erp-next\\docs\\.old\\architecture.md · Decisões 2 e 3", note: "Fonte local consultada em 27/10/2026. Não é atestado de operação em produção." }] }),
    seed({ id: "ERP-ACCESS-002", product: "erp", title: "Consulta de acesso exige associação ativa à empresa", category: "access", state: "implemented",
      rule: "A consulta de acesso filtra a empresa solicitada, o subject autenticado e os estados ativos da empresa e da associação. Sem correspondência, retorna acesso proibido.",
      owner: "A definir", enforcement: "apps/api/src/platform/access.rs · load_access; current_access utiliza o cabeçalho x-tenant-id.", verificationDate: "",
      sources: [{ kind: "code", location: "D:\\Projetos\\SaaS\\erp-next\\apps\\api\\src\\platform\\access.rs · load_access", note: "Implementação lida. Isolamento com banco real ainda não verificado neste inventário." }] }),
    seed({ id: "EXP-NUMERIC-001", product: "experiments", title: "Tolerância numérica não amplia a faixa permitida", category: "execution", state: "implemented",
      rule: "A aproximação numérica e a faixa permitida são gates distintos. Um resultado pode passar na tolerância e reprovar no limite comercial.",
      owner: "A definir", enforcement: "src/evaluators.ts · numericTolerance e numberRange; o executor precisa aplicar seus próprios limites.", verificationDate: "",
      sources: [{ kind: "code", location: "src/evaluators.ts", note: "Ávila Experiments; referência relativa ao repositório independente." },
        { kind: "test", location: "test/custom-evaluators.test.mjs", note: "Casos de fronteira e de reprovação de faixa apesar de tolerância aceita." }] }),
    seed({ id: "EXP-PUBLIC-001", product: "experiments", title: "Publicar apenas uma árvore validada de evidências selecionadas", category: "publication", state: "implemented",
      rule: "Gerar uma árvore pública nova, conferir arquivos e hashes e promover somente a saída válida. Relatórios privados, logs e credenciais não integram a exportação.",
      owner: "A definir", enforcement: "dashboard/public-export.mjs e dashboard/build.mjs.", verificationDate: "",
      sources: [{ kind: "code", location: "dashboard/public-export.mjs", note: "Valida raiz, data/, tipos e integridade dos artefatos." },
        { kind: "test", location: "dashboard/test/public-export.test.mjs", note: "Resíduos, falhas e concorrência de exportação." }] }),
    seed({ id: "LOJAS-PRICE-001", product: "lojas", title: "Cotação deve usar as condições aplicáveis ao cliente", category: "commercial", state: "proposed",
      rule: "Determinar tabela e condições a partir do cliente autenticado. Revalidar vigência, quantidades e valores antes de confirmar o pedido; não aceitar preço calculado pelo navegador como autoridade.",
      owner: "A definir", enforcement: "A mapear no checkout existente. Proposta, sem alegação de implementação.", verificationDate: "",
      sources: [{ kind: "document", location: "POLICIES.md · Inventário inicial", note: "Proposta discutida em 27/10/2026; depende de inspeção do produto." }] }),
    seed({ id: "LOJAS-CACHE-001", product: "lojas", title: "Preço negociado não deve entrar em cache público compartilhado", category: "data", state: "proposed",
      rule: "Separar o catálogo público da cotação específica de cliente. O cache de uma cotação precisa respeitar o contexto de autorização e as condições comerciais.",
      owner: "A definir", enforcement: "A mapear nas consultas e no cache do Ávila Lojas.", verificationDate: "",
      sources: [{ kind: "document", location: "POLICIES.md · Inventário inicial", note: "Proposta; não confirma comportamento atual do produto." }] }),
  ];
}

function missing(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT"; }

export function parsePolicyImportDocument(value: unknown): PolicyDraft[] {
  let entries: unknown[];
  if (Array.isArray(value)) entries = value;
  else {
    const catalog = record(value, "arquivo");
    exact(catalog, ["revision", "updatedAt", "products", "policies", "history"]);
    if (!Array.isArray(catalog.policies)) invalid("O arquivo deve conter uma lista de fichas ou uma exportação do caderno.");
    if (catalog.policies.length < 1 || catalog.policies.length > 500) invalid("O arquivo deve conter de 1 a 500 fichas.");
    // An export transfers current policy fields only. Revision, history and
    // snapshot metadata never become imported audit records.
    entries = catalog.policies.map((value, index) => {
      const { version, updatedAt, ...policy } = record(value, "ficha exportada");
      if (!Number.isSafeInteger(version) || (version as number) < 1 || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
        invalid(`Ficha ${index + 1}: metadados inválidos na ficha exportada.`);
      }
      return policy;
    });
  }
  if (entries.length < 1 || entries.length > 500) invalid("O arquivo deve conter de 1 a 500 fichas.");
  const ids = new Set<string>();
  return entries.map((entry, index) => {
    try {
      const policy = parsePolicy(entry);
      if (ids.has(policy.id)) invalid(`Código duplicado no arquivo: ${policy.id}.`);
      ids.add(policy.id);
      return policy;
    } catch (error) {
      if (error instanceof ApiError) throw new ApiError(error.status, error.code, `Ficha ${index + 1}: ${error.message}`);
      throw error;
    }
  });
}

function planImport(current: PolicyCatalog, document: unknown): PolicyImportPreview {
  const existing = new Map(current.policies.map(policy => [policy.id, policy]));
  const items = parsePolicyImportDocument(document).map(policy => {
    const previous = existing.get(policy.id);
    if (!previous) return { policy, action: "create" as const, different: false };
    const { version: _version, updatedAt: _updatedAt, ...previousDraft } = previous;
    return { policy, action: "preserve" as const, different: canonicalJson(previousDraft) !== canonicalJson(policy) };
  });
  const createCount = items.filter(item => item.action === "create").length;
  if (current.policies.length + createCount > 500) invalid(`A importação excederia o limite de 500 políticas. Há ${500 - current.policies.length} vagas e o arquivo tem ${createCount} códigos novos.`);
  return { revision: current.revision, createCount, preserveCount: items.length - createCount, items };
}

export class PolicyStore {
  readonly #file: string;
  #updates: Promise<unknown> = Promise.resolve();
  constructor(directory: string) { this.#file = path.join(path.resolve(directory), "policies.json"); }
  async #write(value: PolicyCatalog) {
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, this.#file);
    } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
  }
  async initialize() {
    await mkdir(path.dirname(this.#file), { recursive: true });
    try { await this.#read(); }
    catch (error) {
      if (!missing(error)) throw error;
      const at = new Date().toISOString();
      const policies = initialPolicies().map(policy => ({ ...policy, version: 1, updatedAt: at }));
      await this.#write({ revision: 1, updatedAt: at, products: PRODUCTS, policies,
        history: policies.map(policy => ({ revision: 1, at, changeNote: "Inventário inicial parcial, com fontes e limitações declaradas.", policy })) });
    }
  }
  async #read(): Promise<PolicyCatalog> { return JSON.parse(await readFile(this.#file, "utf8")) as PolicyCatalog; }
  async catalog() { await this.#updates; return this.#read(); }
  async previewImport(document: unknown): Promise<PolicyImportPreview> {
    await this.#updates;
    return planImport(await this.#read(), document);
  }
  importPolicies(document: unknown, changeNote: unknown, revision: number): Promise<PolicyImportResult> {
    const operation = this.#updates.then(async () => {
      const current = await this.#read();
      if (current.revision !== revision) throw new ApiError(412, "REVISION_CONFLICT", "O caderno mudou. Atualize e confira a prévia antes de importar novamente.");
      const note = text(changeNote, "Motivo da importação", 2000);
      const preview = planImport(current, document);
      const created = preview.items.filter(item => item.action === "create").map(item => item.policy.id);
      const preserved = preview.items.filter(item => item.action === "preserve").map(item => item.policy.id);
      if (!created.length) return { catalog: current, created, preserved };
      const at = new Date().toISOString();
      const saved: Policy[] = preview.items.filter(item => item.action === "create").map(item => ({ ...item.policy, version: 1, updatedAt: at }));
      const next = { ...current, revision: current.revision + 1, updatedAt: at,
        policies: [...current.policies, ...saved],
        history: [...current.history, ...saved.map(policy => ({ revision: current.revision + 1, at, changeNote: note, policy }))] };
      // A single atomic catalog replacement commits the whole validated batch.
      await this.#write(next);
      return { catalog: next, created, preserved };
    });
    this.#updates = operation.then(() => undefined, () => undefined);
    return operation;
  }
  update(policy: PolicyDraft, changeNote: string, revision: number): Promise<PolicyCatalog> {
    const operation = this.#updates.then(async () => {
      const current = await this.#read();
      if (current.revision !== revision) throw new ApiError(412, "REVISION_CONFLICT", "O caderno mudou. Sua edição deve ser preservada antes de recarregar.");
      const normalized = parsePolicy(policy);
      const previous = current.policies.find(item => item.id === normalized.id);
      if (previous && previous.product !== normalized.product) invalid("O produto de uma política existente não pode mudar. Cadastre outra política.");
      if (!previous && current.policies.length >= 500) invalid("Limite de 500 políticas neste cadastro.");
      const at = new Date().toISOString();
      const saved: Policy = { ...normalized, version: (previous?.version ?? 0) + 1, updatedAt: at };
      const next = { ...current, revision: current.revision + 1, updatedAt: at,
        policies: previous ? current.policies.map(item => item.id === saved.id ? saved : item) : [...current.policies, saved],
        history: [...current.history, { revision: current.revision + 1, at, changeNote: text(changeNote, "Motivo da alteração", 2000), policy: saved }] };
      await this.#write(next);
      return next;
    });
    this.#updates = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export function parsePolicyUpdate(value: unknown) {
  const input = record(value, "update");
  exact(input, ["policy", "changeNote"]);
  return { policy: parsePolicy(input.policy), changeNote: text(input.changeNote, "Motivo da alteração", 2000) };
}
