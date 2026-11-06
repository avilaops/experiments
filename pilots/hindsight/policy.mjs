// This pilot accepts reviewed synthetic records only. Pattern detection alone
// cannot establish that arbitrary text is free of sensitive business data.
export const QUESTION = "Which synthetic deployment colour was selected, and why?";
export const RECORDS = Object.freeze({
  "avl419-ci-a": "The synthetic agent selected AMBER419 for deployment because reproducibility is preferred. This is a synthetic technical decision.",
  "avl419-ci-b": "The synthetic agent selected COBALT419 for deployment because reproducibility is preferred. This is a synthetic technical decision.",
});
export const MARKERS = Object.freeze({ "avl419-ci-a": "AMBER419", "avl419-ci-b": "COBALT419" });
export const MAX_BYTES = 262144;

export class PilotError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function validateArguments(bank, operation, args) {
  const key = operation === "retain" ? "content" : "query";
  if (!Object.hasOwn(RECORDS, bank) || !["retain", "recall", "reflect"].includes(operation)
    || !args || typeof args !== "object" || Array.isArray(args)
    || Object.keys(args).length !== 1 || !Object.hasOwn(args, key)
    || args[key] !== (operation === "retain" ? RECORDS[bank] : QUESTION)) {
    throw new PilotError("INPUT_DENIED");
  }
}

export function safeText(bank, value) {
  const other = bank === "avl419-ci-a" ? MARKERS["avl419-ci-b"] : MARKERS["avl419-ci-a"];
  if (typeof value !== "string" || value.length > 16384 || value.toLowerCase().includes(other.toLowerCase())
    || /(?:Bearer\s+\S+|sk-[\w-]{8,}|-----BEGIN|password\s*[:=]|token\s*[:=]|\b\S+@\S+\.\S+|\b\d{11,}\b)/i.test(value)) {
    throw new PilotError("OUTPUT_DENIED");
  }
  return value;
}
