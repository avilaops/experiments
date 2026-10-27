export const PRODUCTS = [
  { id: "shared", name: "Princípios Ávila Ops" },
  { id: "mail", name: "Ávila Mail" }, { id: "cms", name: "Ávila CMS" },
  { id: "crm", name: "Ávila CRM" }, { id: "erp", name: "Ávila ERP" },
  { id: "lojas", name: "Ávila Lojas" }, { id: "tms", name: "Ávila TMS" },
  { id: "experiments", name: "Ávila Experiments" },
] as const;
export const POLICY_STATES = {
  proposed: "Proposta", documented: "Documentada", implemented: "Implementada",
  verified: "Verificada com evidência", retired: "Retirada de uso",
} as const;
export const POLICY_CATEGORIES = {
  access: "Acesso e identidade", commercial: "Comercial e preços", data: "Dados",
  execution: "Execução", publication: "Publicação", integration: "Integrações",
} as const;
export const SOURCE_KINDS = { document: "Documento", code: "Código", test: "Teste", evidence: "Evidência" } as const;
export interface PolicySource { kind: keyof typeof SOURCE_KINDS; location: string; note: string }
export interface PolicyDraft {
  id: string;
  product: typeof PRODUCTS[number]["id"];
  title: string;
  category: keyof typeof POLICY_CATEGORIES;
  state: keyof typeof POLICY_STATES;
  rule: string;
  owner: string;
  enforcement: string;
  verificationDate: string;
  sources: PolicySource[];
}
export interface Policy extends PolicyDraft { version: number; updatedAt: string }
export interface PolicyChange { revision: number; at: string; changeNote: string; policy: Policy }
export interface PolicyCatalog {
  revision: number;
  updatedAt: string;
  products: typeof PRODUCTS;
  policies: Policy[];
  history: PolicyChange[];
}
export interface PolicyImportPreview {
  revision: number;
  createCount: number;
  preserveCount: number;
  items: { policy: PolicyDraft; action: "create" | "preserve"; different: boolean }[];
}
export interface PolicyImportResult {
  catalog: PolicyCatalog;
  created: string[];
  preserved: string[];
}
