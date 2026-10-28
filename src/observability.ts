/** Optional, content-free tracing. Never pass business values or error messages here. */
type Metadata = Record<string, number | boolean>;
let runtime: Promise<typeof import("@langfuse/tracing") | null> | undefined;
let processor: import("@langfuse/otel").LangfuseSpanProcessor | undefined;
let sdk: import("@opentelemetry/sdk-node").NodeSDK | undefined;
let warned = false;
function diagnose() {
  if (!warned) { warned = true; console.warn("Langfuse tracing unavailable; application execution continues"); }
}
const allowedNames = new Set(["run-experiment", "execute-experiment-case", "evaluate-experiment-case",
  "execute-tool-call", "dispatch-registered-tool"]);
function safeLabel(value: string | undefined, fallback: string) {
  return value && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ? value : fallback;
}

function initialize() {
  runtime ??= (async () => {
    if ((process.env.LANGFUSE_ENABLED ?? process.env.LANGFUSE_TRACING_ENABLED) !== "true") return null;
    if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY
      || !process.env.LANGFUSE_BASE_URL) { diagnose(); return null; }
    try {
      const url = new URL(process.env.LANGFUSE_BASE_URL);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        diagnose(); return null;
      }
      const [{ NodeSDK }, { LangfuseSpanProcessor }, tracing] = await Promise.all([
        import("@opentelemetry/sdk-node"), import("@langfuse/otel"), import("@langfuse/tracing"),
      ]);
      processor = new LangfuseSpanProcessor({
        baseUrl: url.toString(), mediaUploadEnabled: false, timeout: 3,
        environment: safeLabel(process.env.LANGFUSE_TRACING_ENVIRONMENT, "default"),
        release: safeLabel(process.env.LANGFUSE_RELEASE, "experiments-0.3.0"),
        shouldExportSpan: ({ otelSpan }) => otelSpan.instrumentationScope.name === "langfuse-sdk"
          && allowedNames.has(otelSpan.name),
      });
      sdk = new NodeSDK({ spanProcessors: [processor], autoDetectResources: false, instrumentations: [] });
      sdk.start();
      process.once("beforeExit", () => { void shutdownObservability(); });
      return tracing;
    } catch { diagnose(); return null; }
  })();
  return runtime;
}

export async function flushObservability(): Promise<void> {
  try { await processor?.forceFlush(); } catch { diagnose(); }
}

export async function shutdownObservability(): Promise<void> {
  try { await sdk?.shutdown(); } catch { diagnose(); }
}

export async function traceOperation<T>(name: string, type: "span" | "tool" | "evaluator",
  metadata: Metadata, action: () => Promise<T>): Promise<T> {
  const tracing = await initialize();
  if (!tracing) return action();
  // Catch inside the callback: SDK exception recording must never capture private error messages.
  let failure: unknown;
  let failed = false;
  let started = false;
  let value!: T;
  const operation = async (observation: { update: (attributes: {
    input?: Metadata; output?: { completed: boolean }; level?: "ERROR"; statusMessage?: string;
  }) => unknown }) => {
    try { observation.update({ input: metadata }); } catch { diagnose(); }
    started = true;
    try {
      value = await action();
    } catch (error) {
      failure = error; failed = true;
    }
    try {
      observation.update(failed
        ? { level: "ERROR", statusMessage: "operation_failed", output: { completed: false } }
        : { output: { completed: true } });
    } catch { diagnose(); }
  };
  try {
    // SDK overloads require a literal observation type.
    if (type === "tool") await tracing.startActiveObservation(name, operation, { asType: "tool" });
    else if (type === "evaluator") await tracing.startActiveObservation(name, operation, { asType: "evaluator" });
    else await tracing.startActiveObservation(name, operation, { asType: "span" });
  } catch {
    diagnose();
    // Never retry an application operation after it may have committed an effect.
    if (!started) return action();
  }
  if (failed) throw failure;
  return value;
}
