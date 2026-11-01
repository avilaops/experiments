import { useEffect, useState } from "react";
import type { ContextAction, ProductContextStore } from "../../src/lab/product-contexts.js";
import { asObject, bodySchema, example, operations, parameters, resolve, responses, schemaType, snippets, text } from "./reference-model.js";
import type { ApiDocument, ApiOperation } from "./reference-model.js";
import { ReferenceSchema } from "./ReferenceSchema.js";
import { WorkflowCanvas } from "./WorkflowCanvas.js";

type FlowView = Awaited<ReturnType<ProductContextStore["view"]>>;
type Language = "curl" | "typescript" | "rust";
const strings = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
async function read(path: string, signal: AbortSignal) {
  const response = await fetch("/experiments" + path, { signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message || "Não foi possível carregar a documentação. Atualize a página para tentar novamente.");
  return value;
}
function Method({ value }: { value: string }) { return <span className={"reference-method method-" + value.toLowerCase()}>{value}</span>; }
function Code({ value }: { value: string }) {
  const parts: React.ReactNode[] = []; let cursor = 0;
  const pattern = /"(?:[^"\\]|\\.)*"|\b(?:const|let|await|async|fn|pub|use|return|if|throw|new|true|false|null|Result|Ok)\b|\b\d+(?:\.\d+)?\b/g;
  for (const match of value.matchAll(pattern)) {
    const index = match.index!;
    if (index > cursor) parts.push(value.slice(cursor, index));
    const kind = match[0].startsWith('"') ? /^\s*:/.test(value.slice(index + match[0].length)) ? "key" : "string" : /^\d/.test(match[0]) ? "number" : "keyword";
    parts.push(<span key={index} className={"reference-token-" + kind}>{match[0]}</span>); cursor = index + match[0].length;
  }
  parts.push(value.slice(cursor));
  return <pre tabIndex={0}><code>{parts}</code></pre>;
}

export function ApiReference() {
  const [document, setDocument] = useState<ApiDocument>();
  const [view, setView] = useState<FlowView>();
  const [source, setSource] = useState<"erp" | "lab">("erp"), [capture, setCapture] = useState("");
  const [query, setQuery] = useState(""), [flowId, setFlowId] = useState("users"), [actionId, setActionId] = useState("");
  const [operationKey, setOperationKey] = useState("PUT /api/v1/client-contracts"), [stepId, setStepId] = useState("");
  const [graphMode, setGraphMode] = useState<"journey" | "dependencies">("journey");
  const [responseStatus, setResponseStatus] = useState(""), [language, setLanguage] = useState<Language>("curl");
  const [loadingApi, setLoadingApi] = useState(true), [loadingFlows, setLoadingFlows] = useState(true);
  const [apiError, setApiError] = useState(""), [flowError, setFlowError] = useState(""), [reload, setReload] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false), [copyMessage, setCopyMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoadingApi(true); setApiError("");
    void read("/openapi.json", controller.signal).then(value => {
      if (!/^3\./.test(text(value.openapi)) || !value.paths || Array.isArray(value.paths) || typeof value.paths !== "object") throw new Error("O contrato retornado não é um documento OpenAPI 3 válido.");
      if (!controller.signal.aborted) setDocument(value);
    }).catch(error => { if (!controller.signal.aborted) setApiError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoadingApi(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController(); setLoadingFlows(true); setFlowError(""); setView(undefined);
    const selection = capture === "published" ? "&mode=published" : capture ? "&sha256=" + encodeURIComponent(capture) : "";
    void read("/api/v1/product-contexts/erp?view=flows" + selection, controller.signal).then(value => {
      if (!Array.isArray(value.flows) || !Array.isArray(value.actions) || !Array.isArray(value.captures)) throw new Error("A captura de fluxos retornou um formato inválido.");
      if (!controller.signal.aborted) setView(value);
    }).catch(error => { if (!controller.signal.aborted) setFlowError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoadingFlows(false); });
    return () => controller.abort();
  }, [capture, reload]);

  const allOperations = document ? operations(document) : [];
  const operation = allOperations.find(item => item.key === operationKey) ?? allOperations[0];
  const flows = view?.flows ?? [], flow = flows.find(item => item.definition.id === flowId) ?? flows[0];
  const allActions = (view?.actions ?? []).filter(item => flow?.actionIds.includes(item.id));
  const stage = flow?.definition.journey?.find(item => item.id === stepId);
  const stageActions = stage ? allActions.filter(item => stage.actionIds.includes(item.id)) : allActions;
  const action = stageActions.find(item => item.id === actionId) ?? stageActions[0];
  const visibleOperations = allOperations.filter(item => [item.title, item.group, item.path, item.method].join(" ").toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const visibleFlows = flows.filter(item => [item.definition.title, item.definition.goal, ...(view?.actions ?? []).filter(action => item.actionIds.includes(action.id)).map(action => action.operation.method + " " + action.operation.path)].join(" ").toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const grouped = [...new Set(visibleOperations.map(item => item.group))];
  const labResponses = document && operation ? responses(document, operation) : [];
  const response = labResponses.find(item => item.status === responseStatus) ?? labResponses[0];
  const requestSchema = document && operation ? bodySchema(document, operation.detail.requestBody) : undefined;
  const generated = requestSchema === undefined || !document ? undefined : example(document, requestSchema);
  const headers = document && operation ? Object.fromEntries(parameters(document, operation).filter(item => item.in === "header").map(item => [text(item.name), String(example(document, item.schema).value)])) : {};
  const actionHeaders = strings(asObject(action?.input).headers).filter(name => name.toLowerCase() !== "authorization");
  const headerVariables = Object.fromEntries(actionHeaders.map(name => [name, "AVILA_" + name.toUpperCase().replace(/[^A-Z0-9]/g, "_")]));
  const sample = source === "lab" && operation ? snippets({ method: operation.method, path: operation.path, headers, ...(generated?.complete ? { body: generated.value } : generated ? { bodyFromEnvironment: true } : {}) })
    : source === "erp" && action ? snippets({ ...action.operation, erp: true, headerVariables, ...(action.input?.body ? { bodyFromEnvironment: true } : {}) }) : undefined;
  const currentPath = source === "lab" ? operation?.path : action?.operation.path;
  const currentMethod = source === "lab" ? operation?.method : action?.operation.method;
  const loading = source === "lab" ? loadingApi : loadingFlows, error = source === "lab" ? apiError : flowError;
  function chooseFlow(id: string) { setFlowId(id); setActionId(""); setStepId(""); setMenuOpen(false); setCopyMessage(""); }
  function chooseAction(id: string) { setActionId(id); setStepId(""); setMenuOpen(false); setCopyMessage(""); }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopyMessage("Exemplo copiado."); }
    catch { setCopyMessage("Selecione o texto do exemplo para copiar."); }
  }
  const dependencyIds = flow ? [flow.definition.id, ...flow.definition.dependencies] : [];
  const graphNodes = graphMode === "dependencies" ? dependencyIds.map(id => { const item = flows.find(value => value.definition.id === id); return { id, title: item?.definition.title ?? id, detail: id === flow?.definition.id ? "Funcionalidade selecionada" : "Dependência declarada" }; })
    : flow?.definition.journey?.map((step, index) => ({ id: step.id, title: `${index + 1}. ${step.title}`, detail: `${step.actionIds.length} ações${step.authRefs.length ? ` · ${step.authRefs.length} operações de sessão` : ""}${step.externalSystems.length ? ` · ${step.externalSystems.join(", ")}` : ""}` }))
      ?? allActions.map(item => ({ id: item.id, title: item.response?.action || item.id, detail: `${item.operation.method} ${item.operation.path}`, blocked: item.status === "blocked" }));
  const graphEdges = graphMode === "dependencies" ? flow?.definition.dependencies.map(id => ({ from: flow.definition.id, to: id })) ?? []
    : flow?.definition.journey?.slice(1).map((step, index) => ({ from: flow.definition.journey![index]!.id, to: step.id })) ?? [];
  return <div className="api-reference">
    <a className="reference-skip" href="#reference-content">Ir para a documentação</a>
    <header className="reference-header"><a className="reference-brand" href="/experiments/">Ávila<span>Referência</span></a><nav aria-label="Laboratório"><a href="/experiments/">Laboratório</a><a href="/experiments/flows">Fluxos</a><a href="/experiments/routes">Rotas</a><a href="/evidencias/">Evidências públicas</a></nav><span className="reference-private">Acesso privado</span>
      <button className="reference-menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>Navegar na documentação</button>
    </header>
    <main className="reference-workspace"><aside className={"reference-sidebar" + (menuOpen ? " is-open" : "")} aria-label="Navegação da documentação">
      <label>Origem da documentação<select value={source} onChange={event => { setSource(event.target.value as "erp" | "lab"); setQuery(""); setCopyMessage(""); }}><option value="erp">Ávila ERP · Fluxos</option><option value="lab">Laboratório · OpenAPI</option></select></label>
      <label>Buscar na documentação<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Funcionalidade ou endpoint"/></label>
      {source === "erp" && <label>Captura do ERP<select value={capture} onChange={event => { setCapture(event.target.value); setStepId(""); }}><option value="">Última importação</option><option value="published">Última versão observada</option>{view?.captures.map(item => <option key={item.contentSha256} value={item.contentSha256}>{item.sourceCommit.slice(0, 8)} · r{item.revision}</option>)}</select></label>}
      <div className="reference-directory">
        {source === "erp" ? <><p className="reference-directory-title">Funcionalidades <span>{visibleFlows.length}</span></p>{visibleFlows.map(item => <div key={item.definition.id} className="reference-flow-menu"><button className="reference-directory-flow" aria-current={flow?.definition.id === item.definition.id ? "page" : undefined} onClick={() => chooseFlow(item.definition.id)}><span>{item.definition.title}</span><small>{item.counts.actions}</small></button>
          {flow?.definition.id === item.definition.id && <ul>{allActions.map(item => <li key={item.id}><button aria-current={action?.id === item.id && !stage ? "true" : undefined} onClick={() => chooseAction(item.id)}><Method value={item.operation.method}/><span>{item.response?.action || item.id}</span></button></li>)}</ul>}
        </div>)}</> : grouped.map(group => <div key={group}><p className="reference-directory-title">{group}</p><ul>{visibleOperations.filter(item => item.group === group).map(item => <li key={item.key}><button aria-current={operation?.key === item.key ? "true" : undefined} onClick={() => { setOperationKey(item.key); setResponseStatus(""); setMenuOpen(false); setCopyMessage(""); }}><Method value={item.method}/><span>{item.title}</span></button></li>)}</ul></div>)}
        {!loading && query && !(source === "erp" ? visibleFlows.length : visibleOperations.length) && <p role="status">Nenhum resultado para esta busca.</p>}
      </div><div className="reference-sidebar-footer"><button className="link" disabled={loading} onClick={() => setReload(value => value + 1)}>Atualizar documentação</button><a href="/experiments/openapi.json" download="avila-lab-openapi.json">Baixar OpenAPI do laboratório</a></div>
    </aside>
    <article className="reference-content" id="reference-content">
      <div className="reference-breadcrumb"><span>{source === "erp" ? "Ávila ERP" : "Laboratório"}</span><span aria-hidden="true">/</span><span>{source === "erp" ? flow?.definition.title || "Funcionalidades" : operation?.group || "API"}</span></div>
      {loading ? <p role="status" className="reference-loading">Carregando a documentação…</p> : error ? <div role="alert" className="reference-error"><h1>Documentação indisponível</h1><p>{error}</p><button onClick={() => { setCapture(""); setReload(value => value + 1); }}>Carregar última versão disponível</button></div> : source === "erp" ? view?.capture && flow ? <>
        <div className="reference-title"><span className="reference-origin">Captura de código · {view.capture.sourceCommit.slice(0, 8)}</span><h1>{flow.definition.title}</h1><p>{flow.definition.goal}</p></div>
        <div className="reference-facts"><span>{flow.counts.actions} ações declaradas</span><span>{view.capture.publication.state === "version_observed" ? "Versão observada" : "Publicação não observada"}</span><span>Execução não observada</span></div>
        <div className="reference-section-heading"><h2>Caminho do dado</h2><div className="reference-segments" role="group" aria-label="Relação do grafo"><button aria-pressed={graphMode === "journey"} onClick={() => setGraphMode("journey")}>Caminho de uso</button><button aria-pressed={graphMode === "dependencies"} onClick={() => setGraphMode("dependencies")}>Dependências</button></div></div>
        <WorkflowCanvas key={`${flow.definition.id}:${graphMode}:${view.capture.contentSha256}`} nodes={graphNodes} edges={graphEdges} relation={graphMode === "dependencies" ? "Dependências declaradas" : flow.definition.journey ? "Sequência de uso declarada" : "Ações sem sequência definida"} selected={graphMode === "dependencies" ? flow.definition.id : stage?.id || (flow.definition.journey ? "" : action?.id || "")} onSelect={id => { if (graphMode === "dependencies") chooseFlow(id); else if (flow.definition.journey) { setStepId(id); setActionId(""); setCopyMessage(""); } else chooseAction(id); }}/>
        {stage && <div className="reference-stage"><h3>{stage.title}</h3>{stage.externalSystems.length > 0 && <p>Serviço externo declarado: {stage.externalSystems.join(", ")}.</p>}{(view.authActions ?? []).filter(item => stage.authRefs.includes(`${item.method} ${item.path}`)).map(item => <p key={item.path}><Method value={item.method}/><code>{item.path}</code><span>{item.action}</span></p>)}</div>}
        <h2>Operações {stage ? "desta etapa" : "da funcionalidade"}</h2><div className="reference-action-list">{stageActions.map(item => <button key={item.id} aria-pressed={action?.id === item.id} onClick={() => { setActionId(item.id); setCopyMessage(""); }}><Method value={item.operation.method}/><span>{item.response?.action || item.id}<code>{item.operation.path}</code></span></button>)}</div>
        {action ? <ErpOperation action={action}/> : <p className="reference-muted">Esta etapa não possui uma operação da API vinculada na captura.</p>}
        <details className="reference-provenance"><summary>Origem e limites desta captura</summary><dl><dt>Repositório</dt><dd>{view.source?.repository}</dd><dt>Commit</dt><dd><code>{view.capture.sourceCommit}</code></dd><dt>SHA-256</dt><dd><code>{view.capture.contentSha256}</code></dd><dt>Importação</dt><dd>{new Date(view.capture.importedAt).toLocaleString("pt-BR")}</dd></dl><ul>{view.limits.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details>
      </> : <div className="reference-empty"><h1>Fluxos do ERP</h1><p>Nenhuma captura de contexto foi importada. Consulte a referência da API do laboratório enquanto prepara a captura do ERP.</p><button onClick={() => setSource("lab")}>Abrir API do laboratório</button></div>
        : document && operation ? <>
          <div className="reference-title"><span className="reference-origin">OpenAPI {text(document.openapi)} · {text(asObject(document.info).version)}</span><h1>{operation.title}</h1><p>{text(operation.detail.description) || "Operação descrita no contrato do laboratório."}</p></div>
          <div className="reference-endpoint"><Method value={operation.method}/><code>{operation.path}</code></div>
          <div className="reference-auth"><strong>Acesso</strong><p>{Array.isArray(operation.detail.security) && !operation.detail.security.length ? "Operação pública descrita no contrato." : "Token Bearer do laboratório. Configure AVILA_API_URL e AVILA_API_TOKEN no ambiente de desenvolvimento."}</p></div>
          <LabParameters document={document} operation={operation}/>
          {requestSchema !== undefined && <div className="reference-doc-section"><h2>Corpo da requisição</h2><p className="reference-muted">application/json{asObject(resolve(document, operation.detail.requestBody)).required ? " · obrigatório" : ""}</p><ReferenceSchema document={document} schema={requestSchema}/></div>}
          <div className="reference-doc-section"><h2>Respostas</h2><div className="reference-response-tabs" role="group" aria-label="Respostas documentadas">{labResponses.map(item => <button key={item.status} aria-pressed={response?.status === item.status} onClick={() => setResponseStatus(item.status)}>{item.status}</button>)}</div>
            {response && <><p>{text(response.detail.description)}</p>{response.schema !== undefined && <ReferenceSchema document={document} schema={response.schema}/>}</>}
          </div>
        </> : <p>Nenhuma operação disponível no contrato.</p>}
    </article>
    <aside className="reference-examples" aria-label="Exemplos da documentação"><div className="reference-example-heading"><span>Exemplo de requisição</span>{sample && <button onClick={() => void copy(sample[language])}>Copiar código</button>}</div>
      <div className="reference-code-tabs" role="group" aria-label="Linguagem do exemplo">{([['curl','cURL'], ['typescript','TypeScript'], ['rust','Rust']] as const).map(([key, label]) => <button key={key} aria-pressed={language === key} onClick={() => { setLanguage(key); setCopyMessage(""); }}>{label}</button>)}</div>
      {loading || error ? <p className="reference-code-note">Os exemplos aparecerão quando a documentação for carregada.</p> : sample ? <><div className="reference-code-endpoint"><Method value={currentMethod || ""}/><code>{currentPath}</code></div><Code value={sample[language]}/><p className="reference-code-note">Exemplo para desenvolvimento. Configure as variáveis de ambiente e revise os valores antes de enviar uma requisição.</p>
        {source === "erp" && <p className="reference-code-note">Origem e token da API ERP: AVILA_ERP_API_URL e AVILA_ERP_API_TOKEN.{action?.input?.body && " Informe o JSON completo em AVILA_REQUEST_BODY; o schema do corpo não faz parte desta captura."}{Object.keys(headerVariables).length > 0 && ` Cabeçalhos adicionais: ${Object.values(headerVariables).join(", ")}.`}</p>}
        {source === "lab" && generated && !generated.complete && <p className="reference-code-note">O contrato não define um exemplo completo do corpo. Informe o JSON em AVILA_REQUEST_BODY.</p>}
      </> : <p className="reference-code-note">Esta etapa descreve uma dependência ou serviço externo. Não há uma operação da API vinculada para gerar o exemplo.</p>}
      <p role="status" aria-live="polite" className="reference-copy-status">{copyMessage}</p>
      <div className="reference-example-heading"><span>{source === "lab" ? `Resposta ${response?.status || ""}` : "Contrato da operação"}</span></div>
      {source === "lab" && document && response?.schema !== undefined ? <><Code value={JSON.stringify(example(document, response.schema).value, null, 2)}/><p className="reference-code-note">Modelo estrutural derivado do schema. Não representa uma resposta executada.</p></> : source === "erp" && action ? <><Code value={JSON.stringify({ operation: action.operation, inputType: action.input?.body?.type ?? null, response: asObject(action.response), permissions: action.permissions ?? [], state: action.status }, null, 2)}/><p className="reference-code-note">Metadados da captura. O corpo de resposta não foi incluído neste catálogo.</p></> : <p className="reference-code-note">Nenhum corpo de resposta foi descrito para esta seleção.</p>}
      <div className="reference-example-footer">Consulta de documentação. Os exemplos são copiados como texto.</div>
    </aside></main>
  </div>;
}

function LabParameters({ document, operation }: { document: ApiDocument; operation: ApiOperation }) {
  const entries = parameters(document, operation);
  if (!entries.length) return null;
  return <div className="reference-doc-section"><h2>Parâmetros e cabeçalhos</h2>{entries.map(item => <div className="reference-parameter" key={text(item.in) + text(item.name)}><div><code>{text(item.name)}</code><span>{text(item.in)} · {schemaType(document, item.schema)}</span>{item.required === true && <small className="reference-required">Obrigatório</small>}</div>{text(item.description) && <p>{text(item.description)}</p>}<ReferenceSchema document={document} schema={item.schema}/></div>)}</div>;
}
function ErpOperation({ action }: { action: ContextAction }) {
  const metadata = asObject(action), input = asObject(action.input), response = asObject(action.response), transition = asObject(metadata.transition), effects = asObject(metadata.effects), concurrency = asObject(metadata.concurrency);
  const statuses = [...(Array.isArray(response.successStatuses) ? response.successStatuses : []), ...(Array.isArray(response.errorStatuses) ? response.errorStatuses : [])].filter(value => typeof value === "number" || typeof value === "string");
  return <div className="reference-erp-operation"><h2>{action.response?.action || action.id}</h2><div className="reference-endpoint"><Method value={action.operation.method}/><code>{action.operation.path}</code></div>
    <p className="reference-origin">{action.status === "blocked" ? "Ação bloqueada no catálogo" : "Implementação declarada no catálogo"} · execução não observada</p>
    {action.input?.body && <div className="reference-doc-section"><h3>Entrada</h3><p><code>{action.input.body.type}</code></p><p className="reference-source-path">{action.input.body.source}</p><p className="reference-muted">A captura informa o tipo de entrada; os campos do schema não foram incluídos.</p></div>}
    {strings(input.headers).length > 0 && <div className="reference-doc-section"><h3>Cabeçalhos declarados</h3><div className="reference-chip-list">{strings(input.headers).map(header => <code key={header}>{header}</code>)}</div></div>}
    <div className="reference-doc-section"><h3>Condições e autorização</h3><ul>{action.preconditions?.map((condition, index) => <li key={index}>{condition}</li>)}</ul><div className="reference-chip-list">{action.permissions?.map(permission => <code key={permission}>{permission}</code>)}</div></div>
    {text(transition.from) && <div className="reference-doc-section"><h3>Transição de estado</h3><dl><dt>Origem</dt><dd>{text(transition.from)}</dd><dt>Destino</dt><dd>{text(transition.to)}</dd></dl></div>}
    {strings(effects.writes).length + strings(effects.external).length > 0 && <div className="reference-doc-section"><h3>Persistência e efeitos declarados</h3><ul>{[...strings(effects.writes), ...strings(effects.external)].map((effect, index) => <li key={index}>{effect}</li>)}</ul></div>}
    {text(concurrency.rule) && <div className="reference-doc-section"><h3>Concorrência e repetição</h3><p>{text(concurrency.rule)}</p></div>}
    {statuses.length > 0 && <div className="reference-doc-section"><h3>Status HTTP declarados</h3><div className="reference-chip-list">{statuses.map((status, index) => <code key={index}>{String(status)}</code>)}</div></div>}
    <div className="reference-doc-section"><h3>Recuperação de falhas</h3><p>{action.recovery || "Recuperação ainda não descrita nesta captura."}</p></div>
    {action.ui?.bff && <p className="reference-source-path">BFF relacionado: {action.ui.bff.method} {action.ui.bff.path}</p>}
    <details className="reference-provenance"><summary>Fontes da operação</summary><ul className="reference-source-path">{action.sources?.map(source => <li key={source}>{source}</li>)}</ul></details>
  </div>;
}
