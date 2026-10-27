import assert from "node:assert/strict";
import test from "node:test";
import { mergePolicyDraft } from "../src/policy-merge.ts";

const policy = () => ({ id: "ERP-TEST-001", product: "erp", title: "Original", category: "access", state: "documented",
  rule: "Regra original", owner: "Equipe", enforcement: "", verificationDate: "",
  sources: [{ kind: "document", location: "policy.md", note: "Original" }] });

test("independent edits are merged without mutating any input", () => {
  const base = policy();
  const local = { ...structuredClone(base), title: "Título local" };
  const current = { ...structuredClone(base), owner: "Responsável atual" };
  const before = structuredClone({ base, local, current });
  const result = mergePolicyDraft(base, local, current);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.draft.title, "Título local");
  assert.equal(result.draft.owner, "Responsável atual");
  result.draft.sources[0].note = "Changed output";
  assert.deepEqual({ base, local, current }, before);
});

test("overlapping edits require a decision while identical concurrent edits are accepted", () => {
  const base = policy();
  const local = { ...base, title: "Local", rule: "Regra comum" };
  const current = { ...base, title: "Atual", rule: "Regra comum", owner: "Outra equipe" };
  const result = mergePolicyDraft(base, local, current);
  assert.deepEqual(result.conflicts, ["title"]);
  assert.equal(result.draft.title, "Local");
  assert.equal(result.draft.rule, "Regra comum");
  assert.equal(result.draft.owner, "Outra equipe");
});

test("source removals and concurrent source edits conflict as a complete field", () => {
  const base = policy();
  const local = { ...base, sources: [] };
  const current = structuredClone(base);
  current.sources[0].note = "Referência revista";
  assert.deepEqual(mergePolicyDraft(base, local, current).conflicts, ["sources"]);
  const reorderedKeys = { ...base, sources: [{ note: "Original", location: "policy.md", kind: "document" }] };
  assert.deepEqual(mergePolicyDraft(base, reorderedKeys, current).conflicts, []);
  assert.deepEqual(mergePolicyDraft(base, reorderedKeys, current).draft.sources, current.sources);
});

test("changing identity or product during conflict review is refused", () => {
  const base = policy();
  assert.throws(() => mergePolicyDraft(base, { ...base, id: "ERP-OTHER-001" }, base), /identidade/);
  assert.throws(() => mergePolicyDraft(base, base, { ...base, product: "lojas" }), /identidade/);
});
