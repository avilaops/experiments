import type { PolicyDraft } from "../../src/lab/policy-contracts.js";

export const POLICY_FIELD_LABELS = {
  title: "Título", category: "Categoria", state: "Situação declarada", rule: "Regra",
  owner: "Responsável", enforcement: "Local de aplicação",
  verificationDate: "Data de verificação", sources: "Fontes e evidências",
} as const;

export type PolicyField = keyof typeof POLICY_FIELD_LABELS;

function sameField(left: PolicyDraft, right: PolicyDraft, field: PolicyField): boolean {
  if (field !== "sources") return left[field] === right[field];
  // References are one ordered field. Merge by position could pair a source with
  // another editor's note or silently restore a deliberately removed reference.
  const references = (policy: PolicyDraft) => policy.sources.map(({ kind, location, note }) => [kind, location, note]);
  return JSON.stringify(references(left)) === JSON.stringify(references(right));
}

/** Preserve independent changes and require a decision for overlapping edits. */
export function mergePolicyDraft(base: PolicyDraft, local: PolicyDraft, current: PolicyDraft) {
  if ([local, current].some(policy => policy.id !== base.id || policy.product !== base.product)) {
    throw new Error("A identidade da ficha mudou. Cancele a edição e abra a ficha atual.");
  }
  const draft = structuredClone(local);
  const conflicts: PolicyField[] = [];
  for (const field of Object.keys(POLICY_FIELD_LABELS) as PolicyField[]) {
    if (sameField(local, base, field)) {
      Object.assign(draft, { [field]: structuredClone(current[field]) });
    } else if (!sameField(current, base, field) && !sameField(current, local, field)) {
      conflicts.push(field);
    }
  }
  return { draft, conflicts };
}
