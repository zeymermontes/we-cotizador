import type { Lang } from '../../../../lib/form-types';
import { text } from '../../../../lib/form-types';
import {
  type Filter, type FilterOp, type ColumnDef, type ViewConfig,
  FILTER_OP_LABEL, opsForColumn, STATUS_ORDER, STATUS_LABEL, uidFilter,
} from '../../../../lib/registrations';

interface Props {
  view: ViewConfig;
  columns: ColumnDef[];
  lang: Lang;
  onChange: (v: ViewConfig) => void;
}

export default function FilterBar({ view, columns, lang, onChange }: Props) {
  const fixed = columns.filter(c => !c.question);
  const questions = columns.filter(c => c.question);
  const byKey = new Map(columns.map(c => [c.key, c]));

  const setFilter = (i: number, patch: Partial<Filter>) =>
    onChange({ ...view, filters: view.filters.map((f, k) => (k === i ? { ...f, ...patch } : f)) });

  const add = () => {
    const col = byKey.get('status') ?? columns[0];
    onChange({ ...view, filters: [...view.filters, { id: uidFilter(), column: col.key, op: opsForColumn(col)[0], value: defaultValueFor(col) }] });
  };

  if (view.filters.length === 0) {
    return <button className="btn btn-secondary btn-xs" onClick={add}>+ Filtro</button>;
  }

  return (
    <div className="filters-box">
      {view.filters.length > 1 && (
        <div className="filter-row">
          <span>Mostrar registros que cumplan</span>
          <select className="glass-select" value={view.match} onChange={e => onChange({ ...view, match: e.target.value as 'all' | 'any' })}>
            <option value="all">todos los filtros</option>
            <option value="any">cualquier filtro</option>
          </select>
        </div>
      )}
      {view.filters.map((f, i) => {
        const col = byKey.get(f.column);
        const ops = col ? opsForColumn(col) : (['eq'] as FilterOp[]);
        const needsValue = f.op !== 'empty' && f.op !== 'not_empty';
        return (
          <div key={f.id} className="filter-row">
            <select
              className="glass-select"
              value={f.column}
              onChange={e => {
                const nc = byKey.get(e.target.value as Filter['column']);
                if (!nc) return;
                setFilter(i, { column: nc.key, op: opsForColumn(nc)[0], value: defaultValueFor(nc) });
              }}
            >
              <optgroup label="Datos">
                {fixed.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
              {questions.length > 0 && (
                <optgroup label="Preguntas">
                  {questions.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </optgroup>
              )}
            </select>
            <select className="glass-select" value={f.op} onChange={e => setFilter(i, { op: e.target.value as FilterOp })}>
              {ops.map(op => <option key={op} value={op}>{FILTER_OP_LABEL[op]}</option>)}
            </select>
            {needsValue && col && <ValueInput col={col} lang={lang} value={f.value} onChange={v => setFilter(i, { value: v })} />}
            <button className="btn btn-ghost btn-xs" onClick={() => onChange({ ...view, filters: view.filters.filter((_, k) => k !== i) })}>✕</button>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-secondary btn-xs" onClick={add}>+ Filtro</button>
        <button className="btn btn-ghost btn-xs" onClick={() => onChange({ ...view, filters: [] })}>Limpiar</button>
      </div>
    </div>
  );
}

function defaultValueFor(col: ColumnDef): Filter['value'] {
  if (col.key === 'status') return 'registered';
  if (col.key === 'lang') return 'es';
  if (col.question) {
    const q = col.question;
    if (q.type === 'yes_no' || q.type === 'legal') return true;
    if (q.options?.length) return q.options[0].id;
    if (q.type === 'number' || q.type === 'rating') return 1;
  }
  if (col.key === 'party_size') return 2;
  return '';
}

function ValueInput({ col, lang, value, onChange }: { col: ColumnDef; lang: Lang; value: Filter['value']; onChange: (v: Filter['value']) => void }) {
  if (col.key === 'status') {
    return (
      <select className="glass-select" value={String(value ?? '')} onChange={e => onChange(e.target.value)}>
        {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
    );
  }
  if (col.key === 'lang') {
    return (
      <select className="glass-select" value={String(value ?? 'es')} onChange={e => onChange(e.target.value)}>
        <option value="es">Español</option><option value="en">English</option>
      </select>
    );
  }
  if (col.key === 'created_at') {
    return <input className="input-field" type="datetime-local" value={String(value ?? '')} onChange={e => onChange(e.target.value)} />;
  }
  const q = col.question;
  if (q) {
    if (q.type === 'yes_no' || q.type === 'legal') {
      return (
        <select className="glass-select" value={String(value)} onChange={e => onChange(e.target.value === 'true')}>
          <option value="true">Sí</option><option value="false">No</option>
        </select>
      );
    }
    if (q.options?.length) {
      return (
        <select className="glass-select" value={String(value ?? '')} onChange={e => onChange(e.target.value)}>
          {q.options.map(o => <option key={o.id} value={o.id}>{text(o.label, lang) || '(sin texto)'}</option>)}
        </select>
      );
    }
    if (q.type === 'number' || q.type === 'rating') {
      return <input className="input-field" type="number" value={value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    }
    if (q.type === 'date') {
      return <input className="input-field" type="date" value={String(value ?? '')} onChange={e => onChange(e.target.value)} />;
    }
  }
  if (col.key === 'party_size') {
    return <input className="input-field" type="number" min={1} value={value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  }
  return <input className="input-field" type="text" value={String(value ?? '')} onChange={e => onChange(e.target.value)} placeholder="valor" />;
}
