import { randomUUID } from "node:crypto";
import { traceOperation } from "./observability.js";
import { snapshot, fingerprint } from "./json.js";
import type { AgentTrace } from "./evaluators.js";
import type { JsonValue } from "./types.js";
import { ToolOperationConflictError } from "./tool-operation-store.js";
import type { ToolOperationRequest, ToolOperationStore } from "./tool-operation-store.js";

export interface ToolExecutionIdentity {
  /** Opaque identifiers supplied by the authenticated host, never by a model. */
  correlationId: string;
  parentExecutionId: string | null;
  tenantId: string;
  principalId: string;
  producer: { service: string; version: string };
  versions: { code: string; instruction: string | null; policy: string; model: string | null };
  references: { id: string; version: string }[];
}

export type ToolEffect =
  | { status: "none" | "unknown" }
  | { status: "confirmed"; reference: string };

export interface ToolOutcome {
  output: JsonValue;
  /** Confirmation must come from the domain adapter, not from the generated answer. */
  effect: ToolEffect;
}

export interface RegisteredTool {
  name: string;
  version: string;
  execute: (arguments_: JsonValue, context: ToolExecutionIdentity & {
    executionId: string; callId: string; idempotencyKey: string; signal: AbortSignal;
  }) => ToolOutcome | Promise<ToolOutcome>;
  /** Read-only domain lookup. Only a confirmed receipt can resolve an unknown effect. */
  reconcile?: RegisteredTool["execute"];
}

export type ToolCallStatus = "succeeded" | "failed" | "denied" | "interrupted" | "unknown";

export interface ToolCallResult {
  callId: string;
  status: ToolCallStatus;
  /** Raw output is private to the caller. It is never included in telemetry. */
  output: JsonValue | null;
  /** Persistent replays omit raw output rather than persisting business data. */
  outputAvailable: boolean;
  effect: ToolEffect;
}

export interface ToolCallRecord {
  callId: string;
  action: "execute" | "reconcile";
  tool: string;
  toolVersion: string | null;
  startedAt: string;
  completedAt: string | null;
  authorization: "allowed" | "denied" | "error";
  status: ToolCallStatus | "running";
  effect: ToolEffect;
  arguments: "[REDACTED]";
  result: "[REDACTED]";
  error: "tool_error" | "authorization_error" | "unknown_tool" | "aborted" | "invalid_outcome"
    | "reconciliation_unavailable" | "operation_not_found" | null;
  replayOf: string | null;
}

export interface ToolExecutionTrace {
  schemaVersion: "tool-execution/1";
  executionId: string;
  identity: ToolExecutionIdentity;
  origin: "in_process_executor";
  /** Local recording is not authenticated remote provenance. */
  originAuthenticated: false;
  complete: boolean;
  calls: ToolCallRecord[];
}

export interface ToolExecutionEvent {
  schemaVersion: ToolExecutionTrace["schemaVersion"];
  executionId: string;
  identity: ToolExecutionIdentity;
  sequence: number;
  recordedAt: string;
  kind: "call_started" | "call_finished" | "execution_finished";
  call: ToolCallRecord | null;
  complete: boolean;
}

export interface ToolExecutorOptions {
  identity: ToolExecutionIdentity;
  tools: readonly RegisteredTool[];
  /** The host must check actual identity, tenant and permissions on every attempt. */
  authorize: (request: {
    identity: ToolExecutionIdentity; tool: string; arguments: JsonValue; action: "execute" | "reconcile";
  }) => boolean | Promise<boolean>;
  /** Must acknowledge durable private storage before a tool can be dispatched. */
  append: (event: ToolExecutionEvent) => void | Promise<void>;
  operationStore?: ToolOperationStore;
}

export interface ToolExecutor {
  executionId: string;
  trace: () => ToolExecutionTrace;
  execute: (toolName: string, arguments_: JsonValue, idempotencyKey: string, signal?: AbortSignal) => Promise<ToolCallResult>;
  reconcile: ToolExecutor["execute"];
  finish: () => Promise<ToolExecutionTrace>;
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,127}$/.test(value)) {
    throw new TypeError("Execution metadata requires opaque identifiers of at most 128 characters");
  }
}

function validateIdentity(identity: ToolExecutionIdentity): ToolExecutionIdentity {
  // Select fields explicitly: arbitrary metadata must not enter the journal.
  const result: ToolExecutionIdentity = {
    correlationId: identity.correlationId, parentExecutionId: identity.parentExecutionId,
    tenantId: identity.tenantId, principalId: identity.principalId,
    producer: { service: identity.producer.service, version: identity.producer.version },
    versions: { code: identity.versions.code, instruction: identity.versions.instruction,
      policy: identity.versions.policy, model: identity.versions.model },
    references: identity.references.map((reference) => ({ id: reference.id, version: reference.version })),
  };
  for (const value of [result.correlationId, result.tenantId, result.principalId,
    ...Object.values(result.producer), result.versions.code, result.versions.policy]) identifier(value);
  for (const value of [result.parentExecutionId, result.versions.instruction, result.versions.model]) {
    if (value !== null) identifier(value);
  }
  for (const reference of result.references) { identifier(reference.id); identifier(reference.version); }
  return snapshot(result);
}

function outcomeOf(value: ToolOutcome): ToolOutcome {
  const output = snapshot(value.output);
  const effect = value.effect;
  if (effect.status === "none" || effect.status === "unknown") return { output, effect: { status: effect.status } };
  if (effect.status === "confirmed") {
    identifier(effect.reference);
    return { output, effect: { status: "confirmed", reference: effect.reference } };
  }
  throw new TypeError("Invalid tool effect");
}

/** Serial, process-local execution boundary. It is not a sandbox or a transaction manager. */
export function createToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  const identity = validateIdentity(options.identity);
  if (typeof options.authorize !== "function" || typeof options.append !== "function") {
    throw new TypeError("An authorizer and a private journal are required");
  }
  const authorize = options.authorize;
  const append = options.append;
  const operationStore = options.operationStore;
  const tools = new Map<string, RegisteredTool>();
  for (const tool of options.tools) {
    identifier(tool.name); identifier(tool.version);
    if (tools.has(tool.name) || typeof tool.execute !== "function") throw new TypeError("Invalid tool registry");
    if (tool.reconcile !== undefined && typeof tool.reconcile !== "function") throw new TypeError("Invalid reconciliation adapter");
    tools.set(tool.name, { name: tool.name, version: tool.version, execute: tool.execute,
      ...(tool.reconcile === undefined ? {} : { reconcile: tool.reconcile }) });
  }
  const executionId = randomUUID();
  const calls: ToolCallRecord[] = [];
  const cache = new Map<string, { inputHash: string; result: ToolCallResult }>();
  let queue: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  let closed = false;
  let journalFailed = false;

  function trace(): ToolExecutionTrace {
    return snapshot({ schemaVersion: "tool-execution/1", executionId, identity,
      origin: "in_process_executor", originAuthenticated: false,
      complete: closed && !journalFailed && calls.every((call) => call.completedAt !== null && call.effect.status !== "unknown"
        && !["running", "unknown", "interrupted"].includes(call.status)),
      calls });
  }

  async function record(kind: ToolExecutionEvent["kind"], call: ToolCallRecord | null) {
    try {
      await append(snapshot({ schemaVersion: "tool-execution/1", executionId, identity,
        sequence: ++sequence, recordedAt: new Date().toISOString(), kind, call, complete: trace().complete }));
    } catch {
      journalFailed = true;
      throw new Error("Private execution journal unavailable; execution stopped");
    }
  }

  function enqueue<Value>(action: () => Promise<Value>): Promise<Value> {
    const operation = queue.then(action);
    queue = operation.catch(() => undefined);
    return operation;
  }

  async function useStore<Value>(operation: () => Promise<Value>): Promise<Value> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ToolOperationConflictError) throw error;
      journalFailed = true;
      throw new Error("Persistent operation store unavailable; execution stopped");
    }
  }

  async function invoke(dispatch: RegisteredTool["execute"], input: JsonValue, idempotencyKey: string,
    signal: AbortSignal, call: ToolCallRecord): Promise<{ output: JsonValue | null; outputAvailable: boolean }> {
    call.status = "running";
    await record("call_started", call);
    // Cancellation during journal I/O must still prevent dispatch.
    if (signal.aborted) {
      call.status = "interrupted"; call.error = "aborted";
      return { output: null, outputAvailable: false };
    }
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    // Lazy telemetry initialization can yield before the dispatch race is attached.
    void aborted.catch(() => undefined);
    try {
      // Invoke registered code here; a caller-supplied trace is never consulted.
      const raw = await traceOperation("dispatch-registered-tool", "tool", { reconciliation: call.action === "reconcile" }, async () => {
        if (signal.aborted) throw new Error("aborted");
        return Promise.race([dispatch(snapshot(input), {
        ...snapshot(identity), executionId, callId: call.callId, idempotencyKey, signal,
        }), aborted]);
      });
      try {
        const outcome = outcomeOf(raw);
        call.effect = call.action === "reconcile" && outcome.effect.status !== "confirmed" ? { status: "unknown" } : outcome.effect;
        call.status = call.effect.status === "unknown" ? "unknown" : "succeeded";
        return { output: outcome.output, outputAvailable: true };
      } catch { call.status = "unknown"; call.effect = { status: "unknown" }; call.error = "invalid_outcome"; }
    } catch {
      // A thrown error or abort cannot prove absence of a committed effect.
      call.status = signal.aborted ? "interrupted" : "failed";
      call.effect = { status: "unknown" }; call.error = signal.aborted ? "aborted" : "tool_error";
    } finally { signal.removeEventListener("abort", onAbort); }
    return { output: null, outputAvailable: false };
  }

  function execute(toolName: string, arguments_: JsonValue, idempotencyKey: string, signal: AbortSignal, action: "execute" | "reconcile") {
    identifier(toolName); identifier(idempotencyKey);
    // Capture before queueing: neither the caller nor the authorizer may rewrite the invocation.
    const input = snapshot(arguments_);
    return enqueue(() => traceOperation("execute-tool-call", "span", { reconciliation: action === "reconcile" }, async (): Promise<ToolCallResult> => {
      if (closed || journalFailed) throw new Error("Execution is closed or its journal is unavailable");
      const inputHash = fingerprint({ tool: toolName, arguments: input });
      const cached = action === "execute" ? cache.get(idempotencyKey) : undefined;
      // Another executor may have reconciled an unknown persistent reservation.
      const previous = operationStore && cached?.result.effect.status === "unknown" ? undefined : cached;
      if (previous && previous.inputHash !== inputHash) throw new Error("Idempotency key conflicts with a previous invocation");
      const tool = tools.get(toolName);
      const call: ToolCallRecord = {
        callId: randomUUID(), action, tool: toolName, toolVersion: tool?.version ?? null,
        startedAt: new Date().toISOString(), completedAt: null, authorization: "denied",
        status: "denied", effect: { status: "none" }, arguments: "[REDACTED]", result: "[REDACTED]",
        error: tool ? null : "unknown_tool", replayOf: null,
      };
      calls.push(call);
      if (tool) {
        try {
          const allowed = await authorize({ identity: snapshot(identity), tool: toolName, arguments: snapshot(input), action });
          call.authorization = allowed === true ? "allowed" : "denied";
        } catch { call.authorization = "error"; call.error = "authorization_error"; }
      }

      let output: JsonValue | null = null;
      let outputAvailable = false;
      let operationRequest: ToolOperationRequest | undefined;
      let acquired = false;
      if (call.authorization === "allowed" && signal.aborted) {
        call.status = "interrupted"; call.error = "aborted";
      } else if (call.authorization === "allowed" && previous) {
        call.status = previous.result.status;
        call.effect = snapshot(previous.result.effect);
        call.replayOf = previous.result.callId;
        output = snapshot(previous.result.output);
        outputAvailable = previous.result.outputAvailable;
      } else if (call.authorization === "allowed" && tool) {
        let dispatch = action === "execute" ? tool.execute : tool.reconcile;
        if (action === "reconcile" && (!operationStore || !dispatch)) {
          call.status = "failed"; call.error = "reconciliation_unavailable"; dispatch = undefined;
        } else if (operationStore) {
          operationRequest = { identity: snapshot(identity), tool: toolName, toolVersion: tool.version,
            arguments: snapshot(input), idempotencyKey, executionId, callId: call.callId };
          const request = operationRequest;
          const reservation = action === "execute"
            ? await useStore(() => operationStore.claim(request))
            : { acquired: false, operation: await useStore(() => operationStore.inspect(request)) };
          acquired = reservation.acquired;
          const stored = reservation.operation;
          if (!stored) {
            call.status = "failed"; call.error = "operation_not_found"; dispatch = undefined;
          } else if (!acquired && (action === "execute" || stored.effect.status !== "unknown")) {
            call.status = stored.status; call.effect = snapshot(stored.effect);
            call.replayOf = stored.callId; dispatch = undefined;
          }
        }
        if (dispatch) {
          const observed = await invoke(dispatch, input, idempotencyKey, signal, call);
          output = observed.output; outputAvailable = observed.outputAvailable;
        }
      }
      call.completedAt = new Date().toISOString();
      const result: ToolCallResult = { callId: call.callId, status: call.status as ToolCallStatus, output, outputAvailable, effect: snapshot(call.effect) };
      if (operationStore && operationRequest) {
        const request = operationRequest;
        if (acquired) await useStore(() => operationStore.complete(request, result));
        else if (action === "reconcile" && call.replayOf === null && call.effect.status === "confirmed") {
          const reference = call.effect.reference;
          await useStore(() => operationStore.confirm(request, reference));
        }
      }
      // Reserve unknown outcomes too. An uncertain effect must never be retried automatically.
      if (action === "reconcile") cache.delete(idempotencyKey);
      else if (call.authorization === "allowed" && !previous && call.effect.status !== "none") {
        cache.set(idempotencyKey, { inputHash, result: snapshot(result) });
      } else if (call.status === "succeeded" && !previous) {
        cache.set(idempotencyKey, { inputHash, result: snapshot(result) });
      }
      await record("call_finished", call);
      return result;
    }));
  }

  return {
    executionId,
    trace,
    execute: (toolName, arguments_, key, signal = new AbortController().signal) => execute(toolName, arguments_, key, signal, "execute"),
    reconcile: (toolName, arguments_, key, signal = new AbortController().signal) => execute(toolName, arguments_, key, signal, "reconcile"),
    finish() {
      return enqueue(async () => {
        if (journalFailed) throw new Error("Private execution journal unavailable; execution stopped");
        if (!closed) { closed = true; await record("execution_finished", null); }
        return trace();
      });
    },
  };
}

/** Compatibility projection only: path conformance does not authenticate origin or confirm effects. */
export function toolExecutionPath(trace: ToolExecutionTrace): AgentTrace {
  return {
    complete: trace.complete && trace.calls.every((call) => call.effect.status !== "unknown"),
    // The legacy path format has no unknown state. Fail conservatively rather than
    // dropping an observed attempt that might itself violate a forbidden-node policy.
    steps: trace.calls.map((call) => ({
      node: call.action === "reconcile" ? `${call.tool}:reconcile` : call.tool,
      status: call.status === "succeeded" ? "succeeded" : "failed",
    })),
  };
}
