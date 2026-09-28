import type { Question, Lang, Condition, ConditionGroup, LogicRule, ConditionOp } from '../../../../lib/form-types';
import { OP_LABEL, opsFor, text, uid, TYPE_INFO } from '../../../../lib/form-types';

interface Props {
  question: Question;
  index: number;
  questions: Question[];
  lang: Lang;
  onChange: (q: Question) => void;
}

const label = (q: Question, i: number, lang: Lang) =>
  `${i + 1}. ${text(q.title, lang) || TYPE_INFO[q.type].label}`;

export default function LogicEditor({ question, index, questions, lang, onChange }: Props) {
  // Solo preguntas ANTERIORES pueden condicionar; ocultas también (vienen de la URL).
  const previous = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q, i }) => (i < index || q.type === 'hidden') && q.type !== 'statement' && q.id !== question.id);
  // Solo se puede saltar a preguntas POSTERIORES (o al final).
  const later = questions.map((q, i) => ({ q, i })).filter(({ q, i }) => i > index && q.type !== 'hidden');

  const showIf: ConditionGroup = question.showIf ?? { match: 'all', conditions: [] };
  const rules: LogicRule[] = question.logic ?? [];

  const setShowIf = (g: ConditionGroup | null) => onChange({ ...question, showIf: g && g.conditions.length ? g : null });
  const setRules = (r: LogicRule[]) => onChange({ ...question, logic: r });

  const newCondition = (): Condition | null => {
    const first = previous[0];
    if (!first) return null;
    return { questionId: first.q.id, op: opsFor(first.q.type)[0] ?? 'eq', value: defaultValue(first.q) };
  };

  return (
    <>
      <div className="editor-section">
        <h4>Mostrar solo si…</h4>
        <p className="section-hint">
          {previous.length === 0
            ? 'No hay preguntas anteriores que puedan condicionar esta.'
            : 'Si no se cumple, la pregunta se salta sin que el invitado la vea.'}
        </p>
        <ConditionsEditor
          group={showIf}
          previous={previous}
          lang={lang}
          onChange={setShowIf}
          newCondition={newCondition}
        />
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
                previous={[{ q: question, i: index }, ...previous]}
                lang={lang}
                onChange={g => setRules(rules.map((x, i) => (i === ri ? { ...x, ...(g ?? { match: 'all', conditions: [] }) } : x)))}
                newCondition={() => ({ questionId: question.id, op: opsFor(question.type)[0] ?? 'eq', value: defaultValue(question) })}
                selfLabel="esta pregunta"
              />
              <div className="rule-row" style={{ marginTop: 8 }}>
                <span>→ ir a</span>
                <select
                  className="glass-select"
                  value={r.jumpTo}
                  onChange={e => setRules(rules.map((x, i) => (i === ri ? { ...x, jumpTo: e.target.value } : x)))}
                >
                  {later.map(({ q, i }) => <option key={q.id} value={q.id}>{label(q, i, lang)}</option>)}
                  <option value="end">Fin del formulario (enviar)</option>
                </select>
                <span className="spacer" style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-xs" onClick={() => setRules(rules.filter((_, i) => i !== ri))}>Quitar regla</button>
              </div>
            </div>
          ))}
          <button
            className="btn btn-secondary btn-xs"
            onClick={() => setRules([...rules, {
              id: uid('r'),
              match: 'all',
              conditions: [{ questionId: question.id, op: opsFor(question.type)[0] ?? 'eq', value: defaultValue(question) }],
              jumpTo: later[0]?.q.id ?? 'end',
            }])}
          >
            + Agregar salto
          </button>
        </div>
      )}
    </>
  );
}

function defaultValue(q: Question): string | number | boolean | undefined {
  if (q.type === 'yes_no' || q.type === 'legal') return true;
  if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'dropdown') return q.options?.[0]?.id;
  if (q.type === 'number' || q.type === 'rating') return 1;
  return '';
}

interface CondProps {
  group: ConditionGroup;
  previous: { q: Question; i: number }[];
  lang: Lang;
  onChange: (g: ConditionGroup | null) => void;
  newCondition: () => Condition | null;
  selfLabel?: string;
}

function ConditionsEditor({ group, previous, lang, onChange, newCondition, selfLabel }: CondProps) {
  const setCond = (ci: number, patch: Partial<Condition>) =>
    onChange({ ...group, conditions: group.conditions.map((c, i) => (i === ci ? { ...c, ...patch } : c)) });

  return (
    <div>
      {group.conditions.length > 1 && (
        <div className="rule-row">
          <span>Se cumple si</span>
          <select className="glass-select" value={group.match} onChange={e => onChange({ ...group, match: e.target.value as 'all' | 'any' })}>
            <option value="all">todas</option>
            <option value="any">cualquiera</option>
          </select>
          <span>de estas condiciones:</span>
        </div>
      )}
      {group.conditions.map((c, ci) => {
        const ref = previous.find(p => p.q.id === c.questionId);
        const refQ = ref?.q;
        const ops = refQ ? opsFor(refQ.type) : (['eq'] as ConditionOp[]);
        const needsValue = c.op !== 'empty' && c.op !== 'not_empty';
        return (
          <div key={ci} className="rule-row">
            <select
              className="glass-select"
              value={c.questionId}
              onChange={e => {
                const nq = previous.find(p => p.q.id === e.target.value)?.q;
                setCond(ci, { questionId: e.target.value, op: nq ? opsFor(nq.type)[0] : 'eq', value: nq ? defaultValue(nq) : '' });
              }}
            >
              {previous.map(({ q, i }, idx) => (
                <option key={q.id} value={q.id}>{idx === 0 && selfLabel ? selfLabel : label(q, i, lang)}</option>
              ))}
            </select>
            <select className="glass-select" value={c.op} onChange={e => setCond(ci, { op: e.target.value as ConditionOp })}>
              {ops.map(op => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
            </select>
            {needsValue && refQ && <ValueInput q={refQ} lang={lang} value={c.value} onChange={v => setCond(ci, { value: v })} />}
            <button className="btn btn-ghost btn-xs" onClick={() => onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== ci) })}>✕</button>
          </div>
        );
      })}
      {previous.length > 0 && (
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => { const c = newCondition(); if (c) onChange({ ...group, conditions: [...group.conditions, c] }); }}
        >
          + condición
        </button>
      )}
    </div>
  );
}

function ValueInput({ q, lang, value, onChange }: { q: Question; lang: Lang; value: Condition['value']; onChange: (v: Condition['value']) => void }) {
  if (q.type === 'yes_no' || q.type === 'legal') {
    return (
      <select className="glass-select" value={String(value)} onChange={e => onChange(e.target.value === 'true')}>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'dropdown') {
    return (
      <select className="glass-select" value={String(value ?? '')} onChange={e => onChange(e.target.value)}>
        {(q.options ?? []).map(o => <option key={o.id} value={o.id}>{text(o.label, lang) || '(sin texto)'}</option>)}
      </select>
    );
  }
  if (q.type === 'number' || q.type === 'rating') {
    return <input className="input-field" type="number" value={value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  }
  return <input className="input-field" type="text" value={String(value ?? '')} onChange={e => onChange(e.target.value)} placeholder="valor" />;
}
