import type { Question, Lang, ConditionGroup, ConditionNode, LogicRule, ConditionOp, ConditionValue, Ending } from '../../../../lib/form-types';
import { OP_LABEL, opsFor, text, uid, isGroup, isSpecialVar } from '../../../../lib/form-types';
import { type Candidate, candidatesFor, defaultValueFor, newConditionFor, questionLabel as label } from './logic-helpers';

interface Props {
  question: Question;
  index: number;
  questions: Question[];
  lang: Lang;
  endings?: Ending[];
  onChange: (q: Question) => void;
}

export default function LogicEditor({ question, index, questions, lang, endings = [], onChange }: Props) {
  const previous = candidatesFor(questions, index, lang);
  const withSelf = candidatesFor(questions, index, lang, true);
  const later = questions.map((q, i) => ({ q, i })).filter(({ q, i }) => i > index && q.type !== 'hidden');

  const showIf: ConditionGroup = question.showIf ?? { match: 'all', conditions: [] };
  const rules: LogicRule[] = question.logic ?? [];

  const setShowIf = (g: ConditionGroup | null) => onChange({ ...question, showIf: g && g.conditions.length ? g : null });
  const setRules = (r: LogicRule[]) => onChange({ ...question, logic: r });

  const hasPrevious = previous.some(c => !isSpecialVar(c.id));

  return (
    <>
      <div className="editor-section">
        <h4>Mostrar solo si…</h4>
        <p className="section-hint">
          {hasPrevious
            ? 'Si no se cumple, la pregunta se salta sin que el invitado la vea. Puedes agrupar: (A y B) o C.'
            : 'No hay preguntas anteriores; aún puedes condicionar por idioma, puntaje o fecha.'}
        </p>
        <ConditionsEditor group={showIf} candidates={previous} lang={lang} onChange={setShowIf} />
      </div>

      {question.type !== 'hidden' && (
        <div className="editor-section">
          <h4>Después de responder, saltar a…</h4>
          <p className="section-hint">
            Se evalúan en orden; gana la primera regla que se cumpla. Sin reglas, sigue a la siguiente pregunta.
          </p>
          {rules.map((r, ri) => (
            <div key={r.id} className="rule-card">
              <ConditionsEditor
                group={r}
                candidates={withSelf}
                lang={lang}
                onChange={g => setRules(rules.map((x, i) => (i === ri ? { ...x, ...(g ?? { match: 'all', conditions: [] }) } : x)))}
              />
              <div className="rule-row" style={{ marginTop: 8 }}>
                <span>→ ir a</span>
                <JumpTarget value={r.jumpTo} later={later} lang={lang} endings={endings} onChange={v => setRules(rules.map((x, i) => (i === ri ? { ...x, jumpTo: v } : x)))} />
                <span className="spacer" style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-xs" onClick={() => setRules(rules.filter((_, i) => i !== ri))}>Quitar regla</button>
              </div>
            </div>
          ))}
          <button
            className="btn btn-secondary btn-xs"
            onClick={() => {
              const c = newConditionFor(withSelf[0]);
              setRules([...rules, { id: uid('r'), match: 'all', conditions: c ? [c] : [], jumpTo: later[0]?.q.id ?? 'end' }]);
            }}
          >
            + Agregar salto
          </button>
        </div>
      )}
    </>
  );
}

/** Selector de destino de un salto: pregunta posterior, final por defecto o final alternativo. */
export function JumpTarget({ value, later, lang, endings, onChange }: {
  value: string; later: { q: Question; i: number }[]; lang: Lang; endings: Ending[]; onChange: (v: string) => void;
}) {
  return (
    <select className="glass-select" value={value} onChange={e => onChange(e.target.value)}>
      {later.map(({ q, i }) => <option key={q.id} value={q.id}>{label(q, i, lang)}</option>)}
      <option value="end">Fin del formulario (enviar)</option>
      {endings.map(e => <option key={e.id} value={`end:${e.id}`}>Final: {e.name || text(e.title, lang) || e.id}</option>)}
      {!later.some(l => l.q.id === value) && value !== 'end' && !value.startsWith('end:') && <option value={value}>⚠ destino eliminado</option>}
    </select>
  );
}

// ─── Editor de un grupo de condiciones (recursivo) ───────────

interface CondProps {
  group: ConditionGroup;
  candidates: Candidate[];
  lang: Lang;
  onChange: (g: ConditionGroup | null) => void;
  nested?: boolean;
}

export function ConditionsEditor({ group, candidates, lang, onChange, nested }: CondProps) {
  const setNode = (i: number, node: ConditionNode) => onChange({ ...group, conditions: group.conditions.map((n, k) => (k === i ? node : n)) });
  const removeNode = (i: number) => onChange({ ...group, conditions: group.conditions.filter((_, k) => k !== i) });
  const byId = new Map(candidates.map(c => [c.id, c]));

  return (
    <div className={`cond-group ${nested ? 'nested' : ''}`}>
      {(group.conditions.length > 1 || nested) && (
        <div className="rule-row">
          <span>{nested ? 'Subgrupo:' : 'Se cumple si'}</span>
          <select className="glass-select" value={group.match} onChange={e => onChange({ ...group, match: e.target.value as 'all' | 'any' })}>
            <option value="all">todas</option>
            <option value="any">cualquiera</option>
          </select>
          <span>de estas condiciones:</span>
        </div>
      )}
      {group.conditions.map((node, ci) => {
        if (isGroup(node)) {
          return (
            <div key={ci} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <ConditionsEditor group={node} candidates={candidates} lang={lang} nested onChange={g => (g ? setNode(ci, g) : removeNode(ci))} />
              </div>
              <button className="btn btn-ghost btn-xs" onClick={() => removeNode(ci)} title="Quitar subgrupo">✕</button>
            </div>
          );
        }
        const c = node;
        const ref = byId.get(c.questionId);
        const ops = ref ? opsFor(ref.kind) : [];
        const needsValue = c.op !== 'empty' && c.op !== 'not_empty';
        return (
          <div key={ci} className={`rule-row ${ref ? '' : 'orphan'}`}>
            {!ref && <span className="orphan-tag">⚠ pregunta eliminada:</span>}
            <select
              className="glass-select"
              value={ref ? c.questionId : '__orphan'}
              onChange={e => {
                const nc = byId.get(e.target.value);
                if (!nc) return;
                const op = opsFor(nc.kind)[0] ?? 'eq';
                setNode(ci, { questionId: nc.id, op, value: defaultValueFor(nc, op) });
              }}
            >
              {!ref && <option value="__orphan">(elige otra pregunta)</option>}
              {candidates.map(cand => <option key={cand.id} value={cand.id}>{cand.label}</option>)}
            </select>
            {ref && (
              <select className="glass-select" value={c.op} onChange={e => { const op = e.target.value as ConditionOp; setNode(ci, { ...c, op, value: needsValueFor(op) ? (sameKind(c.op, op) ? c.value : defaultValueFor(ref, op)) : undefined }); }}>
                {ops.map(op => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
              </select>
            )}
            {ref && needsValue && <ValueInput cand={ref} op={c.op} value={c.value} onChange={v => setNode(ci, { ...c, value: v })} />}
            <button className="btn btn-ghost btn-xs" onClick={() => removeNode(ci)}>✕</button>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-ghost btn-xs" onClick={() => { const c = newConditionFor(candidates[0]); if (c) onChange({ ...group, conditions: [...group.conditions, c] }); }}>
          + condición
        </button>
        {!nested && (
          <button className="btn btn-ghost btn-xs" onClick={() => { const c = newConditionFor(candidates[0]); onChange({ ...group, conditions: [...group.conditions, { match: group.match === 'all' ? 'any' : 'all', conditions: c ? [c] : [] }] }); }}>
            + subgrupo
          </button>
        )}
      </div>
    </div>
  );
}

const needsValueFor = (op: ConditionOp) => op !== 'empty' && op !== 'not_empty';
const sameKind = (a: ConditionOp, b: ConditionOp) => {
  const k = (op: ConditionOp) => (op === 'between' ? 'range' : op.startsWith('count_') || op.startsWith('age_') ? 'num' : op === 'before' || op === 'after' ? 'date' : 'val');
  return k(a) === k(b);
};

function ValueInput({ cand, op, value, onChange }: { cand: Candidate; op: ConditionOp; value: ConditionValue | undefined; onChange: (v: ConditionValue) => void }) {
  if (op === 'between') {
    const [lo, hi] = Array.isArray(value) ? value : [0, 10];
    return (
      <>
        <input className="input-field" type="number" style={{ minWidth: 70 }} value={lo} onChange={e => onChange([Number(e.target.value), hi])} />
        <span>y</span>
        <input className="input-field" type="number" style={{ minWidth: 70 }} value={hi} onChange={e => onChange([lo, Number(e.target.value)])} />
      </>
    );
  }
  if (op.startsWith('count_') || op.startsWith('age_')) {
    return <input className="input-field" type="number" min={0} style={{ minWidth: 70 }} value={typeof value === 'number' ? value : ''} onChange={e => onChange(Number(e.target.value))} />;
  }
  if (op === 'before' || op === 'after') {
    const isToday = value === '$today';
    return (
      <>
        <select className="glass-select" value={isToday ? '$today' : 'date'} onChange={e => onChange(e.target.value === '$today' ? '$today' : '')}>
          <option value="$today">hoy</option>
          <option value="date">una fecha…</option>
        </select>
        {!isToday && <input className="input-field" type="date" value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
      </>
    );
  }
  if (cand.kind === 'yes_no' || cand.kind === 'legal') {
    return (
      <select className="glass-select" value={String(value)} onChange={e => onChange(e.target.value === 'true')}>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (cand.options?.length) {
    return (
      <select className="glass-select" value={String(value ?? '')} onChange={e => onChange(e.target.value)}>
        {cand.options.map(o => <option key={o.id} value={o.id}>{o.label || '(sin texto)'}</option>)}
      </select>
    );
  }
  if (cand.kind === 'number' || cand.kind === 'rating') {
    return <input className="input-field" type="number" value={value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  }
  if (cand.kind === 'date') {
    return <input className="input-field" type="date" value={String(value ?? '')} onChange={e => onChange(e.target.value)} />;
  }
  return <input className="input-field" type="text" value={String(value ?? '')} onChange={e => onChange(e.target.value)} placeholder="valor" />;
}
