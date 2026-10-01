// Vista de nodos del flujo del formulario.
//  - Cada pregunta es un nodo; las flechas son las salidas posibles
//    (orden normal, ramas "solo si", saltos). Solo una salida se cumple.
//  - Nodos en rojo/amarillo: problemas del linter.
//  - Clic en un nodo: resalta todos los caminos que pasan por él.
//    Doble clic: abre la pregunta en el editor.
//  - Simulador: respondes a un lado y se ilumina el camino real.
//  - Secciones: carriles agrupados. Diff: contra la versión publicada.
//  - Tráfico: grosor de cada rama según cuánta gente pasó por ahí.
import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, BaseEdge, EdgeLabelRenderer, type Node, type Edge, type NodeProps, type EdgeProps } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import type { FormSchema, Question, Lang, Condition, ConditionGroup, SchemaIssue, Answers, AnswerValue, FlowEdge } from '../../../../lib/form-types';
import { TYPE_INFO, OP_LABEL, SPECIAL_VARS, text, isStep, isGroup, buildFlowGraph, enumeratePaths, resolveFlowDetailed, visibleOptions, computeScore, singleOptionCondition, exitValues } from '../../../../lib/form-types';

interface Props {
  schema: FormSchema;
  lang: Lang;
  selectedId: string | null;
  issues: SchemaIssue[];
  published: FormSchema | null;
  traffic: { answers: Answers; lang: Lang }[] | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onLoadTraffic: () => Promise<void>;
}

interface Exit { id: string; label: string; color: string; kind: 'option' | 'cond' | 'else' }

/** Ancho del nodo: crece con el número de salidas para que los chips no se encimen. */
const widthFor = (exits: number) => Math.max(NODE_W, exits * 104);

type QNodeData = {
  kind: 'start' | 'end' | 'question' | 'hidden' | 'section';
  exits?: Exit[];
  width?: number;
  n?: number;
  title: string;
  type?: string;
  icon?: string;
  required?: boolean;
  identity?: string | null;
  showIf?: string | null;
  selected?: boolean;
  issue?: SchemaIssue | null;
  dimmed?: boolean;
  diff?: 'added' | 'changed' | 'removed' | null;
  traffic?: number | null;
  trafficTotal?: number | null;
};

const NODE_W = 250;
const COLORS = ['#2d5a57', '#b45309', '#6d28d9', '#be123c', '#0e7490', '#4d7c0f'];

// ─── Texto de condiciones ────────────────────────────────────

function refLabel(id: string, byId: Map<string, Question>, lang: Lang): string {
  const sv = SPECIAL_VARS.find(s => s.id === id);
  if (sv) return text(sv.label, lang);
  const q = byId.get(id);
  const t = q ? (text(q.title, lang) || TYPE_INFO[q.type].label) : '?';
  return t.length > 28 ? t.slice(0, 26) + '…' : t;
}

function condText(c: Condition, byId: Map<string, Question>, lang: Lang): string {
  const q = byId.get(c.questionId);
  const sv = SPECIAL_VARS.find(s => s.id === c.questionId);
  let v = '';
  if (c.op !== 'empty' && c.op !== 'not_empty') {
    if (Array.isArray(c.value)) v = `${c.value[0]} y ${c.value[1]}`;
    else if (q && (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'dropdown')) {
      const o = q.options?.find(x => x.id === String(c.value));
      v = o ? text(o.label, lang) : String(c.value ?? '');
    } else if (sv?.options) v = text(sv.options.find(o => o.id === String(c.value))?.label, lang, String(c.value ?? ''));
    else if (q && (q.type === 'yes_no' || q.type === 'legal')) v = c.value === true || c.value === 'true' ? 'Sí' : 'No';
    else v = c.value === '$today' ? 'hoy' : String(c.value ?? '');
  }
  return `${refLabel(c.questionId, byId, lang)} ${OP_LABEL[c.op]}${v ? ` "${v}"` : ''}`;
}

function groupText(g: ConditionGroup, byId: Map<string, Question>, lang: Lang): string {
  const parts = g.conditions.map(n => (isGroup(n) ? `(${groupText(n, byId, lang)})` : condText(n, byId, lang)));
  return parts.join(g.match === 'any' ? '  o  ' : '  y  ');
}

// ─── Nodo ────────────────────────────────────────────────────

function QuestionNode({ data }: NodeProps<Node<QNodeData>>) {
  const d = data;
  if (d.kind === 'section') {
    return <div className="flow-section" style={{ width: '100%', height: '100%' }}><span className="flow-section-label">{d.title}</span></div>;
  }
  const cls = [
    'flow-node', d.kind,
    d.selected ? 'selected' : '',
    d.issue ? `has-${d.issue.level}` : '',
    d.dimmed ? 'dimmed' : '',
    d.diff ? `diff-${d.diff}` : '',
  ].join(' ');
  return (
    <div className={cls} style={{ width: d.width ?? NODE_W }} title={d.issue?.message}>
      {d.kind !== 'start' && <Handle type="target" position={Position.Top} />}
      {d.kind === 'question' || d.kind === 'hidden' ? (
        <>
          <div className="flow-node-head">
            <span className="item-icon">{d.icon}</span>
            <span className="flow-node-n">{d.kind === 'hidden' ? 'oculto' : `P${d.n}`}</span>
            <span className="flow-node-type">{d.type}</span>
            {d.required && <span title="Obligatoria">*</span>}
            {d.diff && <span className={`diff-tag ${d.diff}`}>{d.diff === 'added' ? 'NUEVA' : d.diff === 'changed' ? 'CAMBIÓ' : 'QUITADA'}</span>}
          </div>
          <div className="flow-node-title">{d.title || <i>Sin título</i>}</div>
          {d.identity && <div className="flow-node-tag">id: {d.identity}</div>}
          {d.showIf && <div className="flow-node-showif">Solo si {d.showIf}</div>}
          {d.issue && <div className={`flow-node-issue ${d.issue.level}`}>{d.issue.level === 'error' ? '⛔' : '⚠️'} {d.issue.message.replace(/^Pregunta \d+: /, '')}</div>}
          {d.traffic != null && d.trafficTotal ? <div className="flow-node-traffic"><b>{d.traffic}</b> de {d.trafficTotal} pasaron ({Math.round((d.traffic / d.trafficTotal) * 100)}%)</div> : null}
          {d.exits && d.exits.length > 0 && d.exits.map((ex, i) => (
            <Handle key={ex.id} type="source" position={Position.Bottom} id={ex.id} style={{ left: `${((i + 1) / (d.exits!.length + 1)) * 100}%`, background: ex.color }} />
          ))}
        </>
      ) : (
        <>
          <div className="flow-node-title" style={{ textAlign: 'center' }}>{d.title}</div>
          {d.traffic != null && d.trafficTotal ? <div className="flow-node-traffic" style={{ textAlign: 'center' }}><b>{d.traffic}</b> de {d.trafficTotal}</div> : null}
        </>
      )}
      {d.kind !== 'end' && !(d.exits && d.exits.length > 0) && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

type ExitEdgeData = { label: string; color: string; kind: Exit['kind']; count?: number | null; hidden?: boolean; index?: number };

/** Cable: baja del chip, cruza en horizontal justo debajo (antes de la fila de destinos) y baja al destino. */
function wirePath(sx: number, sy: number, tx: number, ty: number, jogY: number): string {
  const r = 12;
  if (Math.abs(tx - sx) < 1) return `M ${sx},${sy} L ${tx},${ty}`;
  const dir = tx > sx ? 1 : -1;
  const jy = Math.min(jogY, ty - r - 4);
  return [
    `M ${sx},${sy}`,
    `L ${sx},${jy - r}`,
    `Q ${sx},${jy} ${sx + dir * r},${jy}`,
    `L ${tx - dir * r},${jy}`,
    `Q ${tx},${jy} ${tx},${jy + r}`,
    `L ${tx},${ty}`,
  ].join(' ');
}

function ExitEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps<Edge<ExitEdgeData>>) {
  const d = data!;
  const path = wirePath(sourceX, sourceY, targetX, targetY, sourceY + 48 + (d.index ?? 0) * 8);
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className={`flow-exit on-wire ${d.kind}`}
          style={{ transform: `translate(-50%, 0) translate(${sourceX}px, ${sourceY + 12}px)`, borderColor: d.color, color: d.color, opacity: d.hidden ? 0.15 : 1 }}
          title={d.label}
        >
          {d.label}{d.count != null ? <span className="flow-exit-count">{d.count}</span> : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { q: QuestionNode };
const edgeTypes = { exit: ExitEdge };

// ─── Construcción del grafo ──────────────────────────────────

interface BuildOpts {
  schema: FormSchema; lang: Lang; selectedId: string | null;
  issues: SchemaIssue[];
  highlightNodes: Set<string> | null; highlightEdges: Set<string> | null;
  diff: Map<string, 'added' | 'changed' | 'removed'> | null; removedQuestions: Question[];
  nodeTraffic: Map<string, number> | null; edgeTraffic: Map<string, number> | null; trafficTotal: number;
}

function buildGraph(o: BuildOpts): { nodes: Node<QNodeData>[]; edges: Edge[] } {
  const { schema, lang } = o;
  const all = schema.questions;
  const byId = new Map(all.map(q => [q.id, q]));
  const steps = all.filter(isStep);
  const hidden = all.filter(q => q.type === 'hidden');
  const issueOf = new Map<string, SchemaIssue>();
  for (const i of o.issues) if (i.questionId && (!issueOf.has(i.questionId) || (issueOf.get(i.questionId)!.level === 'warning' && i.level === 'error'))) issueOf.set(i.questionId, i);
  const dim = (id: string) => (o.highlightNodes ? !o.highlightNodes.has(id) : false);
  const tr = (id: string) => (o.nodeTraffic ? (o.nodeTraffic.get(id) ?? 0) : null);

  const nodes: Node<QNodeData>[] = [];
  const flowEdges = buildFlowGraph(schema);
  const endTargets = Array.from(new Set(flowEdges.map(e => e.target).filter(t => t === 'end' || t.startsWith('end:'))));
  if (!endTargets.includes('end')) endTargets.push('end');

  nodes.push({ id: 'start', type: 'q', position: { x: 0, y: 0 }, data: { kind: 'start', title: 'Bienvenida', dimmed: dim('start'), traffic: tr('start'), trafficTotal: o.trafficTotal } });
  steps.forEach((q, i) => {
    nodes.push({
      id: q.id, type: 'q', position: { x: 0, y: 0 },
      data: {
        kind: 'question', n: i + 1, title: text(q.title, lang), type: TYPE_INFO[q.type].label, icon: TYPE_INFO[q.type].icon,
        required: q.required, identity: q.identity ?? null,
        showIf: q.showIf?.conditions.length && !flowEdges.some(e => e.target === q.id && e.group && singleOptionCondition(e.group, e.source) !== null) ? groupText(q.showIf, byId, lang) : null,
        selected: q.id === o.selectedId, issue: issueOf.get(q.id) ?? null, dimmed: dim(q.id),
        diff: o.diff?.get(q.id) ?? null, traffic: tr(q.id), trafficTotal: o.trafficTotal,
      },
    });
  });
  hidden.forEach(q => {
    nodes.push({ id: q.id, type: 'q', position: { x: 0, y: 0 }, data: { kind: 'hidden', title: `{{${q.key ?? ''}}}`, type: 'Campo oculto', icon: TYPE_INFO.hidden.icon, selected: q.id === o.selectedId, issue: issueOf.get(q.id) ?? null, dimmed: dim(q.id), diff: o.diff?.get(q.id) ?? null } });
  });
  for (const t of endTargets) {
    const ending = t.startsWith('end:') ? (schema.settings.endings ?? []).find(e => e.id === t.slice(4)) : null;
    nodes.push({ id: t, type: 'q', position: { x: 0, y: 0 }, data: { kind: 'end', title: ending ? `Final: ${ending.name || text(ending.title, lang) || ending.id}` : 'Enviar · Gracias', dimmed: dim(t), traffic: tr(t), trafficTotal: o.trafficTotal } });
  }
  // Preguntas quitadas (modo diff): fantasmas sin flechas
  for (const q of o.removedQuestions) {
    nodes.push({ id: `removed:${q.id}`, type: 'q', position: { x: 0, y: 0 }, data: { kind: 'question', title: text(q.title, lang), type: TYPE_INFO[q.type].label, icon: TYPE_INFO[q.type].icon, diff: 'removed' } });
  }

  const edges: Edge[] = [];
  const maxTraffic = o.edgeTraffic ? Math.max(1, ...Array.from(o.edgeTraffic.values())) : 1;
  const exitsByNode = new Map<string, Exit[]>();

  /** Salida (chip) por la que sale cada arista de una pregunta. */
  const exitFor = (q: Question, fe: FlowEdge, allFrom: FlowEdge[]): Exit | null => {
    const list = exitsByNode.get(q.id) ?? [];
    const pick = (id: string, label: string, kind: Exit['kind']) => {
      let ex = list.find(e => e.id === id);
      if (!ex) { ex = { id, label, color: kind === 'else' ? '#9a9a9a' : COLORS[list.filter(e => e.kind !== 'else').length % COLORS.length], kind }; list.push(ex); exitsByNode.set(q.id, list); }
      return ex;
    };
    if (fe.kind === 'branch' || fe.kind === 'jump') {
      const v = singleOptionCondition(fe.group, q.id);
      if (v !== null) {
        const opt = q.options?.find(x => x.id === v);
        const label = opt ? text(opt.label, lang) : (q.type === 'yes_no' || q.type === 'legal') ? (v === 'true' ? 'Sí' : 'No') : v;
        return pick(`opt:${v}`, label, 'option');
      }
      return pick(`cond:${fe.id}`, (fe.kind === 'jump' ? 'salta si ' : 'si ') + (fe.group ? groupText(fe.group, byId, lang) : ''), 'cond');
    }
    if (fe.kind === 'else') {
      const values = exitValues(q);
      const covered = new Set(allFrom.filter(e => e.group).map(e => singleOptionCondition(e.group, q.id)).filter((x): x is string => x !== null));
      const uncovered = values ? values.filter(x => !covered.has(x)) : [];
      let label = 'si no';
      if (values && uncovered.length > 0 && uncovered.length <= 3 && covered.size > 0) {
        label = uncovered.map(x => { const opt = q.options?.find(y => y.id === x); return opt ? text(opt.label, lang) : (x === 'true' ? 'Sí' : x === 'false' ? 'No' : x); }).join(' / ');
        if (!q.required) label += ' / sin respuesta';
      } else if (!q.required && values && uncovered.length === 0) label = 'sin respuesta';
      else if (!q.required) label = 'sin respuesta / si no';
      return pick('else', label, 'else');
    }
    return null;
  };

  for (const q of steps) {
    const from = flowEdges.filter(e => e.source === q.id);
    for (const fe of from) exitFor(q, fe, from);
  }
  // Orden de chips: opciones en el orden de la pregunta, luego condiciones, luego "si no"
  for (const q of steps) {
    const list = exitsByNode.get(q.id);
    if (!list) continue;
    const order = (ex: Exit) => ex.kind === 'option' ? (exitValues(q)?.indexOf(ex.id.slice(4)) ?? 0) : ex.kind === 'cond' ? 100 : 200;
    list.sort((a, b) => order(a) - order(b));
    const node = nodes.find(n => n.id === q.id);
    if (node) node.data.exits = list;
  }

  for (const fe of flowEdges) {
    const n = o.edgeTraffic ? (o.edgeTraffic.get(`${fe.source}>${fe.target}`) ?? 0) : null;
    const width = n != null ? 1 + (n / maxTraffic) * 5 : undefined;
    const hidden = o.highlightEdges ? !o.highlightEdges.has(fe.id) : false;
    const q = byId.get(fe.source);
    const ex = q ? (exitsByNode.get(q.id) ?? []).find(e => {
      if (fe.kind === 'else') return e.id === 'else';
      const v = singleOptionCondition(fe.group, q.id);
      return v !== null ? e.id === `opt:${v}` : e.id === `cond:${fe.id}`;
    }) : undefined;
    const color = ex ? ex.color : '#b5b5b5';
    edges.push({
      id: fe.id, source: fe.source, target: fe.target, sourceHandle: ex?.id, type: ex ? 'exit' : 'smoothstep',
      data: ex ? { label: ex.label, color, kind: ex.kind, count: n, hidden, index: (exitsByNode.get(fe.source) ?? []).indexOf(ex) } : undefined,
      label: !ex && n != null ? String(n) : undefined, labelStyle: { fill: color, fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
      style: { opacity: hidden ? 0.12 : 1, stroke: color, strokeWidth: width ?? (ex && ex.kind !== 'else' ? 1.6 : 1) },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    });
  }

  // ── Acomodo automático (con secciones como clusters)
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 90, ranksep: 80, marginx: 20, marginy: 20 });
  const sections = new Map<string, string[]>();
  for (const q of steps) if (q.section) { if (!sections.has(q.section)) sections.set(q.section, []); sections.get(q.section)!.push(q.id); }
  for (const [name, ids] of sections) {
    if (ids.length < 1) continue;
    g.setNode(`sec:${name}`, { label: name, clusterLabelPos: 'top' });
  }
  for (const n of nodes) {
    const d = n.data;
    const w = widthFor(d.exits?.length ?? 0);
    d.width = w;
    const lines = Math.ceil((d.title?.length ?? 10) / (w / 7.5)) + (d.showIf ? Math.ceil(d.showIf.length / 36) : 0) + (d.identity ? 1 : 0) + (d.issue ? 2 : 0) + (d.traffic != null ? 1 : 0);
    // Espacio extra bajo el nodo para los chips sobre el cable
    const h = (d.kind === 'question' || d.kind === 'hidden' ? 56 + lines * 18 : 44 + (d.traffic != null ? 16 : 0)) + (d.exits?.length ? 30 : 0);
    g.setNode(n.id, { width: w, height: h });
    const q = byId.get(n.id);
    if (q?.section && isStep(q)) g.setParent(n.id, `sec:${q.section}`);
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const sectionNodes: Node<QNodeData>[] = [];
  for (const [name] of sections) {
    const p = g.node(`sec:${name}`);
    if (!p) continue;
    sectionNodes.push({
      id: `sec:${name}`, type: 'q', position: { x: p.x - p.width / 2, y: p.y - p.height / 2 },
      style: { width: p.width, height: p.height, background: 'transparent', border: 'none', padding: 0 },
      data: { kind: 'section', title: name }, selectable: false, draggable: false, zIndex: -1,
    });
  }
  const centerY = new Map<string, number>();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) { n.position = { x: p.x - p.width / 2, y: p.y - p.height / 2 }; centerY.set(n.id, p.y); }
  }

  // ── Simetría: los destinos de una misma pregunta se ordenan como sus chips
  const posOf = new Map(nodes.map(n => [n.id, n]));
  for (const q of steps) {
    const exits = exitsByNode.get(q.id);
    if (!exits || exits.length < 2) continue;
    const targetsInOrder: string[] = [];
    for (const ex of exits) {
      const e = flowEdges.find(fe => fe.source === q.id && (fe.kind === 'else' ? ex.id === 'else' : (singleOptionCondition(fe.group, q.id) !== null ? ex.id === `opt:${singleOptionCondition(fe.group, q.id)}` : ex.id === `cond:${fe.id}`)));
      if (e && !targetsInOrder.includes(e.target)) targetsInOrder.push(e.target);
    }
    const siblings = targetsInOrder.map(id => posOf.get(id)).filter((n): n is Node<QNodeData> => !!n && byId.has(n.id));
    if (siblings.length < 2) continue;
    // Solo reordenamos los que están en el mismo renglón de dagre
    const y = centerY.get(siblings[0].id) ?? 0;
    const sameRow = siblings.filter(n => Math.abs((centerY.get(n.id) ?? 0) - y) < 2);
    if (sameRow.length < 2) continue;
    const slots = sameRow.map(n => n.position.x + (n.data.width ?? NODE_W) / 2).sort((a, b) => a - b);
    sameRow.forEach((n, i) => { n.position = { ...n.position, x: slots[i] - (n.data.width ?? NODE_W) / 2 }; });
  }
  return { nodes: [...sectionNodes, ...nodes], edges };
}

// ─── Simulador ───────────────────────────────────────────────

function SimInput({ q, value, answers, lang, onChange }: { q: Question; value: AnswerValue | undefined; answers: Answers; lang: Lang; onChange: (v: AnswerValue) => void }) {
  const opts = visibleOptions(q, answers, { lang, score: 0 });
  switch (q.type) {
    case 'single_choice': case 'dropdown':
      return <select className="glass-select" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || null)}><option value="">(sin responder)</option>{opts.map(o => <option key={o.id} value={o.id}>{text(o.label, lang)}</option>)}</select>;
    case 'multiple_choice':
      return <select className="glass-select" multiple value={Array.isArray(value) ? value : []} onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}>{opts.map(o => <option key={o.id} value={o.id}>{text(o.label, lang)}</option>)}</select>;
    case 'yes_no': case 'legal':
      return <select className="glass-select" value={value === true ? 'true' : value === false ? 'false' : ''} onChange={e => onChange(e.target.value === '' ? null : e.target.value === 'true')}><option value="">(sin responder)</option><option value="true">Sí</option><option value="false">No</option></select>;
    case 'number': case 'rating':
      return <input className="input-field" type="number" value={typeof value === 'number' ? value : ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'date':
      return <input className="input-field" type="date" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || null)} />;
    case 'statement':
      return <span className="text-muted text-xs">pantalla informativa</span>;
    default:
      return <input className="input-field" type="text" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || null)} placeholder="texto" />;
  }
}

// ─── Componente ──────────────────────────────────────────────

export default function FormFlow({ schema, lang, selectedId, issues, published, traffic, onSelect, onEdit, onLoadTraffic }: Props) {
  const [showSim, setShowSim] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [trafficMode, setTrafficMode] = useState(false);
  const [loadingTraffic, setLoadingTraffic] = useState(false);
  const [simAnswers, setSimAnswers] = useState<Answers>({});
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const byId = useMemo(() => new Map(schema.questions.map(q => [q.id, q])), [schema]);

  const toggleTraffic = (on: boolean) => {
    setTrafficMode(on);
    if (on && !traffic) { setLoadingTraffic(true); onLoadTraffic().finally(() => setLoadingTraffic(false)); }
  };

  const paths = useMemo(() => enumeratePaths(schema), [schema]);
  const pathStats = useMemo(() => {
    const lens = paths.map(p => p.filter(id => byId.has(id)).length);
    return { count: paths.length, min: lens.length ? Math.min(...lens) : 0, max: lens.length ? Math.max(...lens) : 0 };
  }, [paths, byId]);

  const flowEdges = useMemo(() => buildFlowGraph(schema), [schema]);
  const edgeBetween = (a: string, b: string): FlowEdge | undefined => flowEdges.find(e => e.source === a && e.target === b);

  // Camino del simulador
  const sim = useMemo(() => {
    if (!showSim) return null;
    const r = resolveFlowDetailed(schema, simAnswers, { lang });
    const nodesOnPath = ['start', ...r.path, r.endingId ? `end:${r.endingId}` : 'end'];
    const edgeIds = new Set<string>();
    for (let i = 0; i + 1 < nodesOnPath.length; i++) { const e = edgeBetween(nodesOnPath[i], nodesOnPath[i + 1]); if (e) edgeIds.add(e.id); }
    return { path: r.path, endingId: r.endingId, nodes: new Set(nodesOnPath), edges: edgeIds, score: computeScore(schema, simAnswers) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSim, schema, simAnswers, lang]);

  // Resaltado por nodo: todos los caminos que pasan por él
  const focus = useMemo(() => {
    if (!focusNode || showSim) return null;
    const through = paths.filter(p => p.includes(focusNode));
    const nodes = new Set<string>(); const edges = new Set<string>();
    for (const p of through) {
      p.forEach(id => nodes.add(id));
      for (let i = 0; i + 1 < p.length; i++) { const e = edgeBetween(p[i], p[i + 1]); if (e) edges.add(e.id); }
    }
    return { nodes, edges, count: through.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNode, paths, showSim]);

  // Diff contra publicada
  const diff = useMemo(() => {
    if (!diffMode || !published) return { map: null, removed: [] as Question[] };
    const map = new Map<string, 'added' | 'changed' | 'removed'>();
    const pub = new Map(published.questions.map(q => [q.id, q]));
    for (const q of schema.questions) {
      const p = pub.get(q.id);
      if (!p) map.set(q.id, 'added');
      else if (JSON.stringify(p) !== JSON.stringify(q)) map.set(q.id, 'changed');
    }
    const removed = published.questions.filter(q => !byId.has(q.id));
    return { map, removed };
  }, [diffMode, published, schema, byId]);

  // Tráfico real
  const trafficData = useMemo(() => {
    if (!trafficMode || !traffic) return null;
    const base = published ?? schema;
    const nodeCount = new Map<string, number>(); const edgeCount = new Map<string, number>();
    for (const r of traffic) {
      const res = resolveFlowDetailed(base, r.answers, { lang: r.lang });
      const seq = ['start', ...res.path, res.endingId ? `end:${res.endingId}` : 'end'];
      for (const id of seq) nodeCount.set(id, (nodeCount.get(id) ?? 0) + 1);
      for (let i = 0; i + 1 < seq.length; i++) { const k = `${seq[i]}>${seq[i + 1]}`; edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1); }
    }
    return { nodeCount, edgeCount, total: traffic.length };
  }, [trafficMode, traffic, published, schema]);

  const highlight = sim ?? focus;
  const { nodes, edges } = useMemo(() => buildGraph({
    schema, lang, selectedId, issues,
    highlightNodes: highlight?.nodes ?? null, highlightEdges: highlight?.edges ?? null,
    diff: diff.map, removedQuestions: diff.removed,
    nodeTraffic: trafficData?.nodeCount ?? null, edgeTraffic: trafficData?.edgeCount ?? null, trafficTotal: trafficData?.total ?? 0,
  }), [schema, lang, selectedId, issues, highlight, diff, trafficData]);

  const errors = issues.filter(i => i.level === 'error').length;
  const warnings = issues.filter(i => i.level === 'warning').length;
  const simPathQuestions = sim ? sim.path.map(id => byId.get(id)).filter((q): q is Question => !!q) : [];

  return (
    <div className="flow-wrap">
      <div className="flow-toolbar">
        <span className="stat">{pathStats.count} camino{pathStats.count === 1 ? '' : 's'}{pathStats.count ? ` · ${pathStats.min}–${pathStats.max} preguntas` : ''}</span>
        <span className={`lint-badge ${errors ? 'error' : warnings ? 'warning' : 'ok'}`}>{errors ? `⛔ ${errors} error${errors === 1 ? '' : 'es'}` : ''}{errors && warnings ? ' · ' : ''}{warnings ? `⚠️ ${warnings} aviso${warnings === 1 ? '' : 's'}` : ''}{!errors && !warnings ? '✓ sin problemas' : ''}</span>
        {focus && !showSim && <span className="stat">Resaltando {focus.count} camino{focus.count === 1 ? '' : 's'} <button className="btn btn-ghost btn-xs" onClick={() => setFocusNode(null)}>✕</button></span>}
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={showSim} onChange={e => { setShowSim(e.target.checked); setFocusNode(null); }} /> Simulador</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: published ? 'pointer' : 'not-allowed', opacity: published ? 1 : 0.5 }} title={published ? '' : 'Aún no hay versión publicada'}><input type="checkbox" disabled={!published} checked={diffMode} onChange={e => setDiffMode(e.target.checked)} /> Cambios vs publicada</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={trafficMode} onChange={e => toggleTraffic(e.target.checked)} /> Tráfico real{loadingTraffic ? '…' : trafficData ? ` (${trafficData.total})` : ''}</label>
      </div>
      <div className="flow-legend">
        <span><i className="leg solid" /> siguiente</span>
        <span><i className="leg jump" /> cada chip es una salida; solo una se cumple</span>
        <span><i className="leg showif" /> "sin respuesta": la pregunta es opcional</span>
        <span className="text-muted">Clic: resalta sus caminos · Doble clic: editar</span>
      </div>
      <div className={`flow-body ${showSim ? '' : 'no-sim'}`}>
        <div className="flow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_, n) => {
              if (n.id.startsWith('sec:') || n.id.startsWith('removed:')) return;
              setFocusNode(f => (f === n.id ? null : n.id));
              if (byId.has(n.id)) onSelect(n.id);
            }}
            onNodeDoubleClick={(_, n) => { if (byId.has(n.id)) onEdit(n.id); }}
            onPaneClick={() => setFocusNode(null)}
            proOptions={{ hideAttribution: true }}
            minZoom={0.15}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeStrokeWidth={2} />
          </ReactFlow>
        </div>
        {showSim && sim && (
          <div className="flow-sim">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <h4 style={{ flex: 1, margin: 0 }}>Simulador</h4>
              <button className="btn btn-ghost btn-xs" onClick={() => setSimAnswers({})}>Reiniciar</button>
            </div>
            <p className="text-muted text-xs" style={{ marginBottom: 8 }}>Responde como un invitado; el camino se ilumina en el grafo. {sim.path.length} pregunta{sim.path.length === 1 ? '' : 's'} en este camino · puntaje {sim.score}.</p>
            {simPathQuestions.map((q, i) => (
              <div key={q.id} className="sim-q">
                <div className="sim-title">P{schema.questions.filter(isStep).indexOf(q) + 1} · {text(q.title, lang) || TYPE_INFO[q.type].label}</div>
                <SimInput q={q} value={simAnswers[q.id]} answers={simAnswers} lang={lang} onChange={v => setSimAnswers(a => {
                  const next = { ...a, [q.id]: v };
                  // Limpia respuestas de preguntas que ya no están en el camino
                  const keep = new Set(resolveFlowDetailed(schema, next, { lang }).path);
                  for (const k of Object.keys(next)) if (!keep.has(k) && byId.get(k)?.type !== 'hidden') delete next[k];
                  return next;
                })} />
                {i === simPathQuestions.length - 1 && <div className="text-muted text-xs" style={{ marginTop: 4 }}>última pregunta de este camino</div>}
              </div>
            ))}
            <div className="sim-end">
              → {sim.endingId ? `Final: ${(schema.settings.endings ?? []).find(e => e.id === sim.endingId)?.name || sim.endingId}` : 'Enviar · Gracias'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
