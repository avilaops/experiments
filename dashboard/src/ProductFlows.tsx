import { useEffect, useState } from "react";
import type { ProductContextStore, ContextAction } from "../../src/lab/product-contexts.js";

type FlowView = Awaited<ReturnType<ProductContextStore["view"]>>;
const endpoint = "/experiments/api/v1/product-contexts/erp?view=flows";
const short = (value: string) => value.slice(0, 8);
const date = (value: string) => new Date(value).toLocaleString("pt-BR");

export function ProductFlows() {
  const [view, setView] = useState<FlowView>();
  const [capture, setCapture] = useState("");
  const [selected, setSelected] = useState("users");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setView(undefined);
    const selection = capture === "published" ? "&mode=published" : capture ? "&sha256=" + encodeURIComponent(capture) : "";
    void fetch(endpoint + selection, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message || "Não foi possível carregar os fluxos.");
      if (!controller.signal.aborted) setView(value);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [capture, reload]);
  const flows = view?.flows ?? [];
  const flow = flows.find(item => item.definition.id === selected) ?? flows[0];
  const actions = (view?.actions ?? []).filter(action => flow?.actionIds.includes(action.id));
  const visible = flows.filter(item => {
    const own = (view?.actions ?? []).filter(action => item.actionIds.includes(action.id));
    return (!filter || (filter === "blocked" ? item.counts.blocked > 0 : filter === "unmapped" ? item.counts.routesMapped < item.counts.actions : !!item.definition.journey))
      && [item.definition.title, item.definition.id, ...item.pages, ...item.permissions, ...own.map(action => action.operation.method + " " + action.operation.path)].join(" ").toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
  });
  function select(id: string) { setSelected(id); document.getElementById("flow-detail-title")?.focus(); }
  function tree(id: string, parents: string[] = []): React.ReactNode {
    const item = flows.find(value => value.definition.id === id);
    if (!item) return null;
    if (parents.includes(id)) return <li key={id}><span className="flow-warning">Dependência circular: {item.definition.title}</span></li>;
    return <li key={id}><button className="flow-tree-node" onClick={() => select(id)} aria-current={flow?.definition.id === id ? "true" : undefined}>{item.definition.title}<span>{item.counts.actions} ações{item.counts.blocked ? ` · ${item.counts.blocked} bloqueadas no catálogo` : ""}</span></button>
      {item.definition.dependencies.length > 0 && <ul>{item.definition.dependencies.map(dependency => tree(dependency, [...parents, id]))}</ul>}</li>;
  }
  return <div className="shell product-flows">
    <header><a className="brand" href="/experiments/">Ávila<span>Experiments</span></a><nav><a href="/experiments/">Laboratório</a><a href="/experiments/flows" aria-current="page">Fluxos do ERP</a><a href="/experiments/routes">Rotas por produto</a><a href="/experiments/policies">Políticas</a><a href="/experiments/contracts">Contratos de clientes</a></nav><span className="private">Laboratório privado</span></header>
    <main><div className="intro"><div><p className="flow-eyebrow">Contexto por funcionalidade</p><h1>Fluxos do ERP</h1><p>Explore o caminho de cada funcionalidade, suas dependências e o que ainda precisa de evidência.</p></div></div>
      <section className="flow-capture" aria-label="Selecionar captura"><div className="flow-capture-controls"><label>Captura de contexto<select aria-label="Captura de contexto" value={capture} onChange={event => setCapture(event.target.value)}>
        <option value="">Última importação</option><option value="published">Última versão observada</option>{view?.captures.map(item => <option key={item.contentSha256} value={item.contentSha256}>{short(item.sourceCommit)} · {date(item.importedAt)} · {item.sourceDirty ? "com alterações" : "limpo"}</option>)}
      </select></label><button disabled={loading} onClick={() => setReload(value => value + 1)}>Atualizar capturas</button></div>
      {view?.capture && <><div className="flow-provenance"><span>Commit <strong>{short(view.capture.sourceCommit)}</strong></span><span>Checkout {view.capture.sourceDirty ? "com alterações" : "limpo"}</span><span>Importada em {date(view.capture.importedAt)}</span><span>Recibo r{view.capture.revision}</span></div><details><summary>Identificação completa da captura</summary><p className="hash">Commit: {view.capture.sourceCommit}<br/>SHA-256: {view.capture.contentSha256}<br/>Solicitação: {view.capture.requestId}</p></details></>}
      </section>
      {loading && <p role="status" className="notice">Carregando a captura e seus fluxos…</p>}
      {error && <div role="alert" className="conflict"><strong>Captura indisponível</strong><p>{error}</p><button onClick={() => { setCapture(""); setReload(value => value + 1); }}>Voltar à última importação</button></div>}
      {!loading && view && !view.capture && <section><h2>Nenhum contexto importado</h2><p>Os fluxos aparecerão após uma importação confirmada do ERP.</p></section>}
      {view?.capture && <>
        <div className="flow-status-strip" aria-label="Situação da captura"><div><span>Mapeamento de código</span><strong>{flows.length} funcionalidades · {view.actions.length} ações</strong><small>Declarações e relações extraídas das fontes.</small></div><div><span>Versão em produção</span><strong>{view.capture.publication.state === "version_observed" ? "Versão observada" : "Não observada nesta captura"}</strong><small>{view.capture.publication.state === "version_observed" ? date(view.capture.publication.observedAt) : "Importar o código não confirma sua publicação."}</small></div><div><span>Execução dos fluxos</span><strong>Sem evidência associada</strong><small>Nenhum fluxo é aprovado por existir no catálogo.</small></div></div>
        <div className="flow-workspace"><section className="flow-directory" aria-label="Funcionalidades do ERP"><h2>Funcionalidades <span>{flows.length}</span></h2><label>Buscar funcionalidade<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, rota ou permissão"/></label><label>Mostrar<select value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todas as funcionalidades</option><option value="journey">Com sequência definida</option><option value="blocked">Com ação bloqueada no catálogo</option><option value="unmapped">Com vínculo de interface incompleto</option></select></label><p className="muted">{visible.length} de {flows.length} funcionalidades</p>
          <ul className="flow-directory-list">{visible.map(item => <li key={item.definition.id}><button onClick={() => select(item.definition.id)} aria-pressed={flow?.definition.id === item.definition.id}><strong>{item.definition.title}</strong><span>{item.counts.actions} ações · {item.definition.kind === "support" ? "suporte" : "produto"}</span>{item.counts.blocked > 0 && <small className="flow-warning">{item.counts.blocked} bloqueadas no catálogo</small>}</button></li>)}</ul>{!visible.length && <p role="status">Nenhuma funcionalidade corresponde aos filtros.</p>}
        </section>
        {flow && <div className="flow-detail"><section aria-labelledby="flow-detail-title"><div className="section-title"><p className="flow-eyebrow">{flow.definition.kind === "support" ? "Recurso de suporte" : "Funcionalidade de produto"}</p><span className="badge">{flow.definitionState === "journey_defined" ? "Sequência definida" : "Ações mapeadas"}</span></div><h2 id="flow-detail-title" tabIndex={-1}>{flow.definition.title}</h2><p>{flow.definition.goal}</p><div className="flow-stats"><span><strong>{flow.counts.actions}</strong> ações</span><span><strong>{flow.counts.routesMapped}</strong> com rotas mapeadas</span><span><strong>{flow.counts.blocked}</strong> bloqueadas no catálogo</span></div><div className="flow-next"><strong>Próximo passo declarado</strong><p>{flow.definition.nextStep}</p></div>
          <h3>Telas relacionadas</h3><ul className="flow-pages">{flow.pages.map(page => <li key={page}>{page.startsWith("/") && !page.startsWith("//") ? <a href={"https://erp.avilaops.com" + page} target="_blank" rel="noreferrer">{page}</a> : page}</li>)}</ul>{!flow.pages.length && <p className="muted">Nenhuma tela relacionada no catálogo.</p>}
          <details><summary>Permissões declaradas · {flow.permissions.length}</summary><ul>{flow.permissions.map(permission => <li key={permission}><code>{permission}</code></li>)}</ul></details>
        </section>
        <section aria-label="Sequência do fluxo"><h2>Caminho de uso</h2>{flow.definition.journey ? <ol className="flow-journey">{flow.definition.journey.map((step, index) => <li key={step.id}><span className="flow-step-number">{index + 1}</span><div><strong>{step.title}</strong><p>{step.actionIds.length} ações · {step.authRefs.length} operações de sessão{step.externalSystems.length ? ` · sistema externo: ${step.externalSystems.join(", ")}` : ""}</p><span className="badge">Execução não observada</span></div></li>)}</ol> : <p className="muted">A sequência de uso ainda não foi definida para esta funcionalidade.</p>}</section>
        <section aria-label="Dependências da funcionalidade"><h2>Árvore de dependências</h2><p className="muted">Selecione um nó para inspecionar suas ações. A árvore representa dependências declaradas, não chamadas observadas.</p><ul className="flow-tree">{tree(flow.definition.id)}</ul></section>
        <section aria-label="Ações da funcionalidade"><h2>Ações e endpoints <span className="muted">{actions.length}</span></h2>{actions.map(action => <Action key={action.id} action={action}/> )}</section>
        </div>}</div>
        <section aria-label="Decisões pendentes do produto"><h2>Decisões pendentes do ERP <span className="muted">{view.pendingFlows.length}</span></h2><p className="muted">Grupos do catálogo que ainda exigem definição. Não foram atribuídos automaticamente à funcionalidade selecionada.</p>{view.pendingFlows.map(item => <details key={item.id}><summary>{item.title}<span className="badge inconclusive">A definir</span></summary><ul>{item.openDecisions.map((decision, index) => <li key={index}>{decision}</li>)}</ul></details>)}</section>
      </>}
      <footer>Fontes e contratos não comprovam interação, persistência ou autorização em execução. <a href="/experiments/routes">Consultar inventário de rotas</a>.</footer>
    </main></div>;
}

function Action({ action }: { action: ContextAction }) {
  return <details className="flow-action"><summary><span><strong>{action.response?.action || action.id}</strong><code>{action.operation.method} {action.operation.path}</code></span><span className={"badge " + (action.status === "blocked" ? "inconclusive" : "")}>{action.status === "blocked" ? "Bloqueada no catálogo" : "Implementada no catálogo"}</span></summary>
    <p><strong>BFF:</strong> {action.ui?.bff ? `${action.ui.bff.method} ${action.ui.bff.path}` : "Não relacionado"}</p>{action.ui?.gap && <p className="flow-warning">Lacuna declarada: {action.ui.gap}</p>}
    {action.input?.body && <p><strong>Tipo de entrada:</strong> <code>{action.input.body.type}</code><br/><span className="hash">{action.input.body.source}</span></p>}
    <h3>Condições e autorização</h3><ul>{action.preconditions?.map((item, index) => <li key={index}>{item}</li>)}</ul><p className="hash">{action.permissions?.join(" · ") || "Nenhuma permissão relacionada."}</p>
    <h3>Recuperação de falhas</h3><p>{action.recovery || "Não descrita neste contrato."}</p><h3>Fontes relacionadas</h3><ul className="hash">{action.sources?.map(source => <li key={source}>{source}</li>)}</ul>
  </details>;
}
