// Vista de nodos del flujo del formulario: cada pregunta es un nodo y
// las flechas muestran el orden normal, los saltos condicionales y las
// condiciones de "mostrar solo si". Solo lectura (clic = ir a la pregunta).
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, type Node, type Edge, type NodeProps } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import type { FormSchema, Question, Lang, Condition, ConditionGroup } from '../../../../lib/form-types';
import { TYPE_INFO, OP_LABEL, text, isStep } from '../../../../lib/form-types';

interface Props {
  schema: FormSchema;
  lang: Lang;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type QNodeData = {
  kind: 'start' | 'end' | 'question' | 'hidden';
  n?: number;
  title: string;
  type?: string;
  icon?: string;
  required?: boolean;
  identity?: string | null;
  showIf?: string | null;
  selected?: boolean;
};

const NODE_W = 250;
const COLORS = ['#2d5a57', '#b45309', '#6d28d9', '#be123c', '#0e7490', '#4d7c0f'];

function condText(c: Condition, byId: Map<string, Question>, lang: Lang): string {
  const q = byId.get(c.questionId);
  const qTitle = q ? (text(q.title, lang) || TYPE_INFO[q.type].label) : '?';
  const short = qTitle.length > 28 ? qTitle.slice(0, 26) + '…' : qTitle;
  let v = '';
  if (c.op !== 'empty' && c.op !== 'not_empty') {
    if (q && (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'dropdown')) {
      const o = q.options?.find(x => x.id === String(c.value));
      v = o ? text(o.label, lang) : String(c.value ?? '');
    } else if (q && (q.type === 'yes_no' || q.type === 'legal')) v = c.value === true || c.value === 'true' ? 'Sí' : 'No';
    else v = String(c.value ?? '');
  }
  return `${short} ${OP_LABEL[c.op]}${v ? ` "${v}"` : ''}`;
}

function groupText(g: ConditionGroup, byId: Map<string, Question>, lang: Lang): string {
  const parts = g.conditions.map(c => condText(c, byId, lang));
  return parts.join(g.match === 'any' ? '  o  ' : '  y  ');
}

function QuestionNode({ data }: NodeProps<Node<QNodeData>>) {
  const d = data;
  const cls = `flow-node ${d.kind} ${d.selected ? 'selected' : ''}`;
  return (
    <div className={cls} style={{ width: NODE_W }}>
      {d.kind !== 'start' && <Handle type="target" position={Position.Top} />}
      {d.kind === 'question' || d.kind === 'hidden' ? (
        <>
          <div className="flow-node-head">
            <span className="item-icon">{d.icon}</span>
            <span className="flow-node-n">{d.kind === 'hidden' ? 'oculto' : `P${d.n}`}</span>
            <span className="flow-node-type">{d.type}</span>
            {d.required && <span title="Obligatoria">*</span>}
          </div>
          <div className="flow-node-title">{d.title || <i>Sin título</i>}</div>
          {d.identity && <div className="flow-node-tag">id: {d.identity}</div>}
          {d.showIf && <div className="flow-node-showif">Solo si {d.showIf}</div>}
        </>
      ) : (
        <div className="flow-node-title" style={{ textAlign: 'center' }}>{d.title}</div>
      )}
      {d.kind !== 'end' && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

const nodeTypes = { q: QuestionNode };

function buildGraph(schema: FormSchema, lang: Lang, selectedId: string | null): { nodes: Node<QNodeData>[]; edges: Edge[] } {
  const all = schema.questions;
  const byId = new Map(all.map(q => [q.id, q]));
  const steps = all.filter(isStep);
  const hidden = all.filter(q => q.type === 'hidden');
  const nodes: Node<QNodeData>[] = [];
  const edges: Edge[] = [];

  nodes.push({ id: 'start', type: 'q', position: { x: 0, y: 0 }, data: { kind: 'start', title: 'Bienvenida' } });
  steps.forEach((q, i) => {
    nodes.push({
      id: q.id, type: 'q', position: { x: 0, y: 0 },
      data: {
        kind: 'question', n: i + 1, title: text(q.title, lang), type: TYPE_INFO[q.type].label, icon: TYPE_INFO[q.type].icon,
        required: q.required, identity: q.identity ?? null,
        showIf: q.showIf?.conditions.length ? groupText(q.showIf, byId, lang) : null,
        selected: q.id === selectedId,
      },
    });
  });
  hidden.forEach(q => {
    nodes.push({ id: q.id, type: 'q', position: { x: 0, y: 0 }, data: { kind: 'hidden', title: `{{${q.key ?? ''}}}`, type: 'Campo oculto', icon: TYPE_INFO.hidden.icon, selected: q.id === selectedId } });
  });
  nodes.push({ id: 'end', type: 'q', position: { x: 0, y: 0 }, data: { kind: 'end', title: 'Enviar · Gracias' } });

  const nextOf = (i: number) => (i + 1 < steps.length ? steps[i + 1].id : 'end');
  if (steps.length) edges.push({ id: 'e-start', source: 'start', target: steps[0].id, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } });
  else edges.push({ id: 'e-start-end', source: 'start', target: 'end', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } });

  steps.forEach((q, i) => {
    const rules = (q.logic ?? []).filter(r => r.conditions.length > 0);
    rules.forEach((r, ri) => {
      const color = COLORS[ri % COLORS.length];
      edges.push({
        id: `j-${q.id}-${r.id}`, source: q.id, target: byId.has(r.jumpTo) || r.jumpTo === 'end' ? r.jumpTo : 'end',
        type: 'smoothstep', label: `si ${groupText(r, byId, lang)}`, labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#fff', fillOpacity: 0.9 }, style: { stroke: color, strokeWidth: 1.6 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      });
    });
    edges.push({
      id: `n-${q.id}`, source: q.id, target: nextOf(i), type: 'smoothstep',
      label: rules.length ? 'si no' : undefined, labelStyle: { fill: '#999', fontSize: 10 }, labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
      style: { stroke: '#b5b5b5' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#b5b5b5' },
    });
    // showIf: línea punteada desde la pregunta que condiciona
    for (const c of q.showIf?.conditions ?? []) {
      if (!byId.has(c.questionId)) continue;
      edges.push({
        id: `s-${c.questionId}-${q.id}-${c.op}-${String(c.value)}`, source: c.questionId, target: q.id, type: 'smoothstep',
        style: { stroke: '#d97706', strokeDasharray: '5 4', strokeWidth: 1.4 }, animated: true,
        label: condText(c, byId, lang), labelStyle: { fill: '#b45309', fontSize: 10 }, labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#d97706' },
      });
    }
  });

  // Acomodo automático
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 70, marginx: 20, marginy: 20 });
  for (const n of nodes) {
    const d = n.data;
    const lines = Math.ceil((d.title?.length ?? 10) / 32) + (d.showIf ? Math.ceil(d.showIf.length / 36) : 0) + (d.identity ? 1 : 0);
    const h = d.kind === 'question' || d.kind === 'hidden' ? 56 + lines * 18 : 44;
    g.setNode(n.id, { width: NODE_W, height: h });
  }
  // Solo las aristas de secuencia y salto definen el orden; las de showIf no
  for (const e of edges) if (!e.id.startsWith('s-')) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const p = g.node(n.id);
    n.position = { x: p.x - NODE_W / 2, y: p.y - p.height / 2 };
  }
  return { nodes, edges };
}

export default function FormFlow({ schema, lang, selectedId, onSelect }: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(schema, lang, selectedId), [schema, lang, selectedId]);
  return (
    <div className="flow-wrap">
      <div className="flow-legend">
        <span><i className="leg solid" /> orden normal</span>
        <span><i className="leg jump" /> salto condicional ("si …")</span>
        <span><i className="leg showif" /> se muestra solo si …</span>
        <span className="text-muted">Clic en una pregunta para editarla. Pronto: editable aquí mismo.</span>
      </div>
      <div className="flow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, n) => { if (n.id !== 'start' && n.id !== 'end') onSelect(n.id); }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeStrokeWidth={2} />
        </ReactFlow>
      </div>
    </div>
  );
}
