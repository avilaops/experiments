import { createHash } from "node:crypto";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
export const hash = value => createHash("sha256").update(value).digest("hex");
const signature = stat => [stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeNs, stat.ctimeNs].map(String).join(":");
const ordered = value => JSON.stringify(value);

export class InventoryError extends Error {
  constructor(stage, code, { retryable = false, cause } = {}) {
    super(`${stage}: ${code}`, { cause });
    this.stage = stage; this.code = code; this.retryable = retryable;
  }
}

export async function stableFile(file, { afterRead } = {}) {
  const before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new InventoryError("source-read", "UNSAFE_SOURCE_FILE");
  if (before.size > 4n * 1024n * 1024n) throw new InventoryError("source-read", "SOURCE_FILE_TOO_LARGE");
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (signature(before) !== signature(opened)) throw new InventoryError("source-read", "SOURCE_CHANGED", { retryable: true });
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const chunk = await handle.read(buffer, size, buffer.length - size, null);
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    if (size > 4 * 1024 * 1024) throw new InventoryError("source-read", "SOURCE_FILE_TOO_LARGE");
    await afterRead?.();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(file, { bigint: true });
    if (current.isSymbolicLink() || signature(before) !== signature(after) || signature(before) !== signature(current)) {
      throw new InventoryError("source-read", "SOURCE_CHANGED", { retryable: true });
    }
    const bytes = buffer.subarray(0, size);
    return { bytes, sha256: hash(bytes), metadata: signature(before) };
  } finally { await handle.close(); }
}

export function routePath(relativeFile) {
  const segments = relativeFile.replaceAll("\\", "/").split("/").slice(0, -1);
  if (segments.some(segment => segment.startsWith("@") || /^\(\.\.?\.?\)/.test(segment))) {
    throw new InventoryError("route-path", "PARALLEL_OR_INTERCEPTED_ROUTE");
  }
  return "/" + segments.filter(segment => !/^\([^()]+\)$/.test(segment)).join("/");
}

export function routePattern(route, { openapi = false } = {}) {
  if (openapi) return route.split("/").map(segment => segment.replace(/\{[^{}]+\}/g, "[]")).join("/");
  return route.split("/").map(segment => /^\[\[\.\.\.[^\]]+\]\]$/.test(segment) ? "[[...]]"
    : /^\[\.\.\.[^\]]+\]$/.test(segment) ? "[...]"
      : /^\[[^\]]+\]$/.test(segment) ? "[]" : segment).join("/");
}

function requests(node) {
  const found = [];
  function visit(current) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const kind = current.expression.text;
      const argument = current.arguments[kind === "forwardErp" ? 1 : 0];
      if (["fetch", "forwardErp"].includes(kind) && argument
        && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) && argument.text.startsWith("/")) {
        let method = kind === "forwardErp" ? "INHERIT" : "GET";
        const options = current.arguments[1];
        if (kind === "fetch" && options) {
          if (!ts.isObjectLiteralExpression(options)) method = null;
          else {
            for (const property of options.properties) {
              if (ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name))) method = null;
              else if (property.name?.getText().replaceAll(/["']/g, "") === "method") {
                method = ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)
                  ? property.initializer.text.toUpperCase() : null;
              }
            }
          }
        }
        found.push({ kind, path: argument.text, method });
      }
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

export function analyzeHandlers(source, file = "route.ts") {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  if (syntax.parseDiagnostics.length) return { methods: [], declaredMethods: [], exports: [], review: [{ reason: "handler_syntax_error" }] };
  const bindings = new Map();
  const declarations = [];
  const review = [];
  for (const statement of syntax.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && (statement.body || !bindings.has(statement.name.text))) bindings.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) {
      if (ts.isIdentifier(item.name)) bindings.set(item.name.text, item.initializer);
    }
  }
  function resolve(node, seen = new Set()) {
    if (!node) return { status: "needs_review", reason: "unresolved_binding" };
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return resolve(node.expression, seen);
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      return node.body ? { status: "callable", reason: "function_in_source", requests: requests(node) } : { status: "needs_review", reason: "declaration_without_implementation" };
    }
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return { status: "needs_review", reason: "cyclic_local_alias" };
      seen.add(node.text);
      return resolve(bindings.get(node.text), seen);
    }
    if (ts.isCallExpression(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      || ts.isConditionalExpression(node) || ts.isAwaitExpression(node)) return { status: "needs_review", reason: "computed_or_factory_handler" };
    return { status: "not_callable", reason: "non_function_expression" };
  }
  function declare(method, node, external = false) {
    if (METHODS.includes(method)) declarations.push({ method, ...(external
      ? { status: "needs_review", reason: "external_reexport_not_resolved" } : resolve(node)) });
  }
  for (const statement of syntax.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      && !modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (exported && ts.isFunctionDeclaration(statement) && statement.name) declare(statement.name.text, bindings.get(statement.name.text));
    if (exported && ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) {
      if (ts.isIdentifier(item.name)) declare(item.name.text, item.initializer);
      else review.push({ reason: "destructured_export_not_resolved" });
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) review.push({ reason: "wildcard_export_not_resolved" });
      else for (const item of statement.exportClause.elements) if (!item.isTypeOnly) {
        declare(item.name.text, bindings.get((item.propertyName ?? item.name).text), Boolean(statement.moduleSpecifier));
      }
    }
  }
  for (const item of declarations) {
    if (declarations.filter(other => other.method === item.method).length > 1) {
      item.status = "needs_review"; item.reason = "duplicate_method_export";
    }
    if (item.status !== "callable") review.push({ method: item.method, reason: item.reason });
  }
  if (!declarations.length && !review.length) review.push({ reason: "no_supported_http_handler_exports" });
  return { methods: METHODS.filter(method => declarations.some(item => item.method === method && item.status === "callable")),
    declaredMethods: METHODS.filter(method => declarations.some(item => item.method === method)), exports: declarations, review };
}

export const handlerMethods = (source, file) => analyzeHandlers(source, file).methods;

export function routeConflicts(pages, handlers) {
  const conflicts = [];
  for (const [layer, rows] of [["page", pages], ["bff", handlers]]) {
    const groups = new Map();
    for (const row of rows) { const entries = groups.get(row.pattern) ?? []; entries.push(row.source); groups.set(row.pattern, entries); }
    for (const [pattern, sources] of groups) if (sources.length > 1) conflicts.push({ layer, pattern, sources, reason: "equivalent_url_patterns" });
  }
  for (const page of pages) for (const handler of handlers) if (page.pattern === handler.pattern) {
    conflicts.push({ layer: "page_and_handler", pattern: page.pattern, sources: [page.source, handler.source], reason: "page_handler_collision" });
  }
  return conflicts;
}

export async function inventoryWeb(appRoot) {
  const pages = [], handlers = [], review = [], metadata = [];
  const root = await lstat(appRoot, { bigint: true });
  if (!root.isDirectory() || root.isSymbolicLink()) throw new InventoryError("source-read", "UNSAFE_APP_ROOT");
  async function visit(directory) {
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) throw new InventoryError("source-read", "DIRECTORY_CHANGED", { retryable: true });
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"));
    metadata.push([path.relative(appRoot, directory).replaceAll("\\", "/"), signature(before), entries.map(item => item.name)]);
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(appRoot, full).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        metadata.push([relative, signature(await lstat(full, { bigint: true }))]);
        review.push({ source: relative, reason: "symlink_not_followed" }); continue;
      }
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) { await visit(full); continue; }
      if (!/^(?:page|route)\.(?:tsx?|jsx?)$/.test(entry.name)) continue;
      const captured = await stableFile(full);
      metadata.push([relative, captured.metadata]);
      let route;
      try { route = routePath(relative); }
      catch { review.push({ source: relative, reason: "parallel_or_intercepted_route", sha256: captured.sha256 }); continue; }
      const item = { path: route, pattern: routePattern(route), source: relative, sha256: captured.sha256, verification: "not_run" };
      const source = captured.bytes.toString("utf8");
      if (entry.name.startsWith("page.")) {
        const syntax = ts.createSourceFile(entry.name, source, ts.ScriptTarget.Latest, true);
        const literalRequests = syntax.parseDiagnostics.length ? [] : requests(syntax);
        if (syntax.parseDiagnostics.length) review.push({ source: relative, reason: "page_syntax_error" });
        pages.push({ ...item, literalRequests });
      } else {
        const analysis = analyzeHandlers(source, entry.name);
        handlers.push({ ...item, methods: analysis.methods, declaredMethods: analysis.declaredMethods, exports: analysis.exports });
        review.push(...analysis.review.map(value => ({ source: relative, ...value })));
      }
    }
    if (signature(before) !== signature(await lstat(directory, { bigint: true }))) throw new InventoryError("source-read", "DIRECTORY_CHANGED", { retryable: true });
  }
  await visit(appRoot);
  for (const rows of [pages, handlers]) rows.sort((left, right) => left.path.localeCompare(right.path, "en") || left.source.localeCompare(right.source, "en"));
  return { pages, handlers, review, conflicts: routeConflicts(pages, handlers), metadataFingerprint: hash(ordered(metadata)) };
}

/** These links concern explicit literals or URL patterns, never an executed flow. */
export function correlateRoutes(web, api) {
  const bffPatterns = new Map(web.handlers.map(route => [route.pattern, route]));
  const apiOperations = api?.operations ?? [];
  const pageToBff = web.pages.map(page => {
    const candidates = page.literalRequests.filter(item => item.kind === "fetch" && bffPatterns.has(routePattern(item.path)))
      .filter(item => item.method === null || bffPatterns.get(routePattern(item.path)).declaredMethods.includes(item.method))
      .map(item => ({ path: item.path, method: item.method,
        confidence: item.method && bffPatterns.get(routePattern(item.path)).methods.includes(item.method) ? "confirmed" : "probable",
        basis: "literal_fetch_reference_in_page_source" }));
    return { page: page.path, source: page.source, sourceSha256: page.sha256,
      confidence: candidates.some(item => item.confidence === "confirmed") ? "confirmed" : candidates.length ? "probable" : "unidentified", candidates };
  });
  const bffToApi = web.handlers.flatMap(handler => handler.declaredMethods.map(method => {
    const explicit = handler.exports.filter(item => item.method === method && item.status === "callable")
      .flatMap(item => (item.requests ?? []).filter(request => request.kind === "forwardErp")
        .map(request => `/api/v1${request.path}`));
    // ERP prefix mapping is a heuristic until the forwarder implementation is verified.
    const pattern = routePattern(handler.path.replace(/^\/api\/erp(?=\/|$)/, "/api/v1"));
    const callable = handler.exports.some(item => item.method === method && item.status === "callable");
    const candidates = apiOperations.filter(operation => callable && operation.method === method
      && (explicit.includes(operation.path) || operation.pattern === pattern)).map(operation => ({
        path: operation.path, method, operationId: operation.operationId, confidence: "probable",
        basis: explicit.includes(operation.path) ? "literal_forwardErp_argument_and_erp_prefix_convention" : "matching_erp_url_pattern",
      }));
    return { bff: handler.path, method, handlerStatus: handler.exports.find(item => item.method === method)?.status,
      sourceSha256: handler.sha256, confidence: candidates.length ? "probable" : "unidentified",
      reason: !api ? "api_contract_not_captured" : !callable ? "handler_requires_review" : candidates.length ? "static_candidate" : "no_static_match", candidates };
  }));
  return { assurance: "source_relationships_only", pageToBff, bffToApi };
}
