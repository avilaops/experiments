import { useId, useRef, useState } from "react";

export interface WorkflowNode { id: string; title: string; detail: string; blocked?: boolean }
export interface WorkflowEdge { from: string; to: string }
export function WorkflowCanvas({ nodes, edges, selected, onSelect, relation }: {
  nodes: WorkflowNode[]; edges: WorkflowEdge[]; selected: string; onSelect: (id: string) => void; relation: string;
}) {
  const marker = "arrow" + useId().replace(/:/g, "");
  const [zoom, setZoom] = useState(1);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const columns = nodes.length === 1 ? 1 : 2, width = columns * 248 + 48, height = Math.ceil(nodes.length / columns) * 134 + 44;
  const positions = new Map(nodes.map((node, index) => [node.id, { x: 24 + index % columns * 248, y: 24 + Math.floor(index / columns) * 134 }]));
  function edgePath(edge: WorkflowEdge) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (!from || !to) return "";
    if (to.y !== from.y) {
      const x1 = from.x + 108, y1 = from.y + 94, x2 = to.x + 108, y2 = to.y;
      return `M${x1},${y1} C${x1},${y1 + 28} ${x2},${y2 - 28} ${x2},${y2}`;
    }
    const forward = to.x > from.x, x1 = from.x + (forward ? 216 : 0), x2 = to.x + (forward ? 0 : 216), y = from.y + 47;
    return `M${x1},${y} C${x1 + (forward ? 22 : -22)},${y} ${x2 + (forward ? -22 : 22)},${y} ${x2},${y}`;
  }
  return <div className="reference-workflow">
    <div className="reference-canvas-tools"><span>{relation}</span><div role="group" aria-label="Zoom do fluxo">
      <button type="button" aria-label="Diminuir zoom" disabled={zoom <= .6} onClick={() => setZoom(value => Math.max(.6, value - .2))}>−</button>
      <button type="button" aria-label="Restaurar zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Aumentar zoom" disabled={zoom >= 1.8} onClick={() => setZoom(value => Math.min(1.8, value + .2))}>+</button>
    </div></div>
    <div className="reference-canvas" role="region" aria-label="Grafo do fluxo" tabIndex={0}
      onPointerDown={event => { if ((event.target as Element).closest("button") || event.button !== 0) return; pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!pan.current) return; event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX; event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY; }}
      onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }}>
      <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} aria-label={relation}>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" className="reference-arrow"/></marker></defs>
        {edges.map((edge, index) => <path key={index} d={edgePath(edge)} className="reference-edge" markerEnd={`url(#${marker})`}/>)}
        {nodes.map(node => { const position = positions.get(node.id)!; return <foreignObject key={node.id} x={position.x} y={position.y} width="216" height="96">
          <button type="button" className={"reference-node" + (node.blocked ? " is-blocked" : "")} aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}>
            <span className="reference-node-port" aria-hidden="true"/><strong>{node.title}</strong><span>{node.detail}</span>
          </button>
        </foreignObject>; })}
      </svg>
    </div>
    <p className="reference-caption">Selecione um nó para inspecionar suas operações. {edges.length ? "As setas representam relações declaradas na captura." : "A ordem das chamadas ainda não foi declarada."}</p>
  </div>;
}
