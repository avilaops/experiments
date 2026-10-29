export { ROUTE_PRODUCTS as CONTRACT_PRODUCTS } from "./policy-contracts.js";

export const CONTRACT_STATUSES = { draft: "Rascunho", active: "Ativo", completed: "Concluído", cancelled: "Cancelado" } as const;
export const CONTRACT_CYCLES = { one_time: "Único", monthly: "Mensal", yearly: "Anual" } as const;

export interface ClientContractDraft {
  code: string;
  title: string;
  clientName: string;
  clientReference: string;
  product: string;
  status: keyof typeof CONTRACT_STATUSES;
  startDate: string;
  endDate: string;
  /** BRL decimal with exactly two places. Never used for floating-point arithmetic. */
  amount: string;
  billingCycle: keyof typeof CONTRACT_CYCLES;
  notes: string;
}

export interface ClientContract extends ClientContractDraft {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClientContractCatalog { revision: number; contracts: ClientContract[] }
export interface ClientContractChange { revision: number; changeNote: string; contract: ClientContract }
export interface ClientContractHistory { total: number; limit: number; offset: number; items: ClientContractChange[] }
export interface ClientContractSave { id: string | null; contract: ClientContractDraft; changeNote: string }
export interface ClientContractResult { catalog: ClientContractCatalog; contract: ClientContract }
