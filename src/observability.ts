/** Optional, content-free tracing. Never pass business values or error messages here. */
type Metadata = Record<string, number | boolean>;
let runtime: Promise<typeof import("@langfuse/tracing") | null> | undefined;
let processor: import("@langfuse/otel").LangfuseSpanProcessor | undefined;

function initialize() {
  runtime ??= (async () => {
    if (process.env.LANGFUSE_TRACING_ENABLED !== "true" || !process.env.LANGFUSE_PUBLIC_KEY
      || !process.env.LANGFUSE_SECRET_KEY || !process.env.LANGFUSE_BASE_URL) return null;
    try {
      const url = new URL(process.env.LANGFUSE_BASE_URL);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      const [{ NodeSDK }, { LangfuseSpanProcessor }, tracing] = await Promise.all([
        import("@opentelemetry/sdk-node"), import("@langfuse/otel"), import("@langfuse/tracing"),
      ]);
      processor = new LangfuseSpanProcessor();
      const sdk = new NodeSDK({ spanProcessors: [processor] });
      sdk.start();
      process.once("beforeExit", () => { void sdk.shutdown().catch(() => undefined); });
      return tracing;
    } catch { return null; }
  })();
  return runtime;
}

export async function flushObservability(): Promise<void> {
  try { await processor?.forceFlush(); } catch { /* Export cannot affect application results. */ }
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
    try { observation.update({ input: metadata }); } catch { /* Best effort. */ }
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
    } catch { /* Best effort. */ }
  };
  try {
    // SDK overloads require a literal observation type.
    if (type === "tool") await tracing.startActiveObservation(name, operation, { asType: "tool" });
    else if (type === "evaluator") await tracing.startActiveObservation(name, operation, { asType: "evaluator" });
    else await tracing.startActiveObservation(name, operation, { asType: "span" });
  } catch {
    // Never retry an application operation after it may have committed an effect.
    if (!started) return action();
  }
  if (failed) throw failure;
  return value;
}
