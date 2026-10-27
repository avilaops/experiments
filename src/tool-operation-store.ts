import { createHmac, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, snapshot } from "./json.js";
import type { JsonValue } from "./types.js";
import type { ToolCallStatus, ToolEffect, ToolExecutionIdentity } from "./tool-execution.js";

export interface ToolOperationRequest {
  identity: ToolExecutionIdentity;
  tool: string;
  toolVersion: string;
  arguments: JsonValue;
  idempotencyKey: string;
  executionId: string;
  callId: string;
}

export interface StoredToolOperation {
  executionId: string;
  callId: string;
  status: ToolCallStatus;
  effect: ToolEffect;
}

export interface ToolOperationStore {
  claim: (request: ToolOperationRequest) => Promise<{ acquired: boolean; operation: StoredToolOperation }>;
  inspect: (request: ToolOperationRequest) => Promise<StoredToolOperation | null>;
  complete: (request: ToolOperationRequest, result: { status: ToolCallStatus; effect: ToolEffect }) => Promise<void>;
  confirm: (request: ToolOperationRequest, reference: string) => Promise<void>;
}

export class ToolOperationConflictError extends Error {
  constructor() { super("Persistent idempotency key conflicts with the invocation or its versions"); }
}

type RecordValue = { [key: string]: JsonValue };
type SignedRecord = { payload: RecordValue; signature: string };
const SCHEMA = "tool-operation/1";
const HEX = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,127}$/;
const unavailable = () => new Error("Persistent tool operation store is unavailable or invalid");
const isCode = (error: unknown, code: string) => error !== null && typeof error === "object" && "code" in error && error.code === code;

function opaque(value: unknown): asserts value is string {
  if (typeof value !== "string" || !ID.test(value)) throw unavailable();
}

function effectOf(value: unknown): ToolEffect {
  if (!value || typeof value !== "object" || !("status" in value)) throw unavailable();
  if (value.status === "none" || value.status === "unknown") return { status: value.status };
  if (value.status === "confirmed" && "reference" in value) {
    opaque(value.reference);
    return { status: "confirmed", reference: value.reference };
  }
  throw unavailable();
}

/** Immutable, HMAC-bound files on a trusted local filesystem. No expiry or automatic takeover. */
export async function createFileToolOperationStore(directory: string, integrityKey: Uint8Array): Promise<ToolOperationStore> {
  if (!(integrityKey instanceof Uint8Array) || integrityKey.byteLength < 32) {
    throw new TypeError("A stable private integrity key of at least 32 bytes is required");
  }
  const key = Buffer.from(integrityKey);
  const root = path.resolve(directory);
  const digest = (purpose: string, value: unknown) => createHmac("sha256", key).update(purpose).update("\0").update(canonicalJson(value)).digest("hex");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw unavailable();

  async function read(name: string): Promise<SignedRecord | null> {
    try {
      const file = path.join(root, name);
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16_384) throw unavailable();
      const handle = await open(file, "r");
      let bytes: Buffer;
      try {
        // Bounded even if another writer grows the file after lstat.
        const buffer = Buffer.alloc(16_385);
        let length = 0;
        while (length < buffer.length) {
          const result = await handle.read(buffer, length, buffer.length - length, null);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        if (length > 16_384) throw unavailable();
        bytes = buffer.subarray(0, length);
      } finally { await handle.close(); }
      const record = JSON.parse(bytes.toString("utf8")) as SignedRecord;
      if (!record || !record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)
        || typeof record.signature !== "string" || !HEX.test(record.signature)
        || !timingSafeEqual(Buffer.from(record.signature, "hex"), Buffer.from(digest("record", record.payload), "hex"))) throw unavailable();
      if (record.payload.schemaVersion !== SCHEMA) throw unavailable();
      return record;
    } catch (error) {
      if (isCode(error, "ENOENT")) return null;
      throw unavailable();
    }
  }

  async function write(name: string, payload: RecordValue): Promise<boolean> {
    let handle;
    try { handle = await open(path.join(root, name), "wx", 0o600); }
    catch (error) { if (isCode(error, "EEXIST")) return false; throw unavailable(); }
    try {
      await handle.writeFile(canonicalJson({ payload, signature: digest("record", payload) }) + "\n", "utf8");
      await handle.sync();
      return true;
    } catch { throw unavailable(); }
    finally { await handle.close(); }
  }

  const marker = await read("store.json");
  if (!marker) {
    if ((await readdir(root)).length) throw unavailable();
    await write("store.json", { schemaVersion: SCHEMA, kind: "store" });
  }
  if ((await read("store.json"))?.payload.kind !== "store") throw unavailable();

  function address(request: ToolOperationRequest) {
    for (const value of [request.identity.tenantId, request.identity.principalId, request.tool,
      request.toolVersion, request.idempotencyKey, request.executionId, request.callId]) opaque(value);
    const scope = digest("scope", { tenant: request.identity.tenantId, principal: request.identity.principalId,
      tool: request.tool, key: request.idempotencyKey });
    const input = digest("input", { toolVersion: request.toolVersion, arguments: request.arguments,
      versions: request.identity.versions, references: request.identity.references });
    return { scope, input };
  }

  async function inspect(request: ToolOperationRequest) {
    const { scope, input } = address(request);
    const claim = await read(`${scope}.claim.json`);
    if (!claim) {
      if (await read(`${scope}.result.json`) || await read(`${scope}.confirmation.json`)) throw unavailable();
      return null;
    }
    const data = claim.payload;
    if (data.kind !== "claim" || data.scope !== scope || data.input !== input) {
      throw new ToolOperationConflictError();
    }
    opaque(data.executionId); opaque(data.callId);
    let operation: StoredToolOperation = { executionId: data.executionId, callId: data.callId, status: "unknown", effect: { status: "unknown" } };
    const result = await read(`${scope}.result.json`);
    if (result) {
      if (result.payload.kind !== "result" || result.payload.claim !== claim.signature
        || !["succeeded", "failed", "interrupted", "unknown"].includes(String(result.payload.status))) throw unavailable();
      const effect = effectOf(result.payload.effect);
      if (result.payload.status === "succeeded" && effect.status === "unknown") throw unavailable();
      operation = { ...operation, status: result.payload.status as ToolCallStatus, effect };
    }
    const confirmation = await read(`${scope}.confirmation.json`);
    if (confirmation) {
      if (confirmation.payload.kind !== "confirmation" || confirmation.payload.claim !== claim.signature) throw unavailable();
      opaque(confirmation.payload.reference);
      if (operation.effect.status !== "unknown" && (operation.effect.status !== "confirmed"
        || operation.effect.reference !== confirmation.payload.reference)) throw unavailable();
      operation = { ...operation, status: "succeeded", effect: { status: "confirmed", reference: confirmation.payload.reference } };
    }
    return { scope, claim, operation };
  }

  return {
    async claim(request) {
      const { scope, input } = address(request);
      const existing = await inspect(request);
      if (existing) return { acquired: false, operation: existing.operation };
      const acquired = await write(`${scope}.claim.json`, { schemaVersion: SCHEMA, kind: "claim", scope, input,
        executionId: request.executionId, callId: request.callId, recordedAt: new Date().toISOString() });
      const stored = await inspect(request);
      if (!stored) throw unavailable();
      return { acquired, operation: stored.operation };
    },
    async inspect(request) { return (await inspect(request))?.operation ?? null; },
    async complete(request, result) {
      const stored = await inspect(request);
      if (!stored || stored.operation.callId !== request.callId || stored.operation.executionId !== request.executionId
        || !["succeeded", "failed", "interrupted", "unknown"].includes(result.status)) throw unavailable();
      const effect = effectOf(result.effect);
      if (result.status === "succeeded" && effect.status === "unknown") throw unavailable();
      if (stored.operation.effect.status === "confirmed" && effect.status !== "unknown"
        && (effect.status !== "confirmed" || effect.reference !== stored.operation.effect.reference)) throw unavailable();
      const payload = { schemaVersion: SCHEMA, kind: "result", claim: stored.claim.signature,
        status: result.status, effect: effect as unknown as JsonValue };
      if (!await write(`${stored.scope}.result.json`, payload)) throw unavailable();
    },
    async confirm(request, reference) {
      opaque(reference);
      const stored = await inspect(request);
      if (!stored || (stored.operation.effect.status !== "unknown"
        && !(stored.operation.effect.status === "confirmed" && stored.operation.effect.reference === reference))) throw unavailable();
      const payload = { schemaVersion: SCHEMA, kind: "confirmation", claim: stored.claim.signature,
        reference, executionId: request.executionId, callId: request.callId, recordedAt: new Date().toISOString() };
      if (!await write(`${stored.scope}.confirmation.json`, payload)) {
        const current = await inspect(request);
        if (current?.operation.effect.status !== "confirmed" || current.operation.effect.reference !== reference) throw unavailable();
      }
    },
  };
}
