import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();

  function visit(current: unknown, path: string): string {
    if (current === null || typeof current === "boolean" || typeof current === "string") {
      return JSON.stringify(current);
    }
    if (typeof current === "number" && Number.isFinite(current)) {
      return JSON.stringify(current);
    }
    if (typeof current !== "object" || current === null) {
      throw new TypeError(`${path} must contain only finite JSON values`);
    }
    if (ancestors.has(current)) throw new TypeError(`${path} contains a cycle`);
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must be a plain JSON object`);
    }
    if (Object.getOwnPropertySymbols(current).length > 0) {
      throw new TypeError(`${path} contains symbol properties`);
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getOwnPropertyNames(current).length !== current.length + 1) {
          throw new TypeError(`${path} must be a dense JSON array without extra properties`);
        }
        return `[${Array.from({ length: current.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !('value' in descriptor)) {
            throw new TypeError(`${path}[${index}] must be a JSON value`);
          }
          return visit(descriptor.value, `${path}[${index}]`);
        }).join(",")}]`;
      }
      return `{${Object.getOwnPropertyNames(current).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError(`${path}.${key} must be an enumerable JSON value`);
        }
        return `${JSON.stringify(key)}:${visit(descriptor.value, `${path}.${key}`)}`;
      }).join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value, "$");
}

export function snapshot<Value>(value: Value): Value {
  return JSON.parse(canonicalJson(value)) as Value;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
