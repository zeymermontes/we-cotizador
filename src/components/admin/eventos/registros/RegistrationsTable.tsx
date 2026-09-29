import { useRef, useEffect } from 'react';
import type { Lang } from '../../../../lib/form-types';
import { type Registration, type ColumnDef, type ColumnKey, type ViewConfig, cellText, STATUS_BADGE, STATUS_LABEL } from '../../../../lib/registrations';

interface Props {
  rows: Registration[];
  columns: ColumnDef[];
  lang: Lang;
  sort: ViewConfig['sort'];
  selected: Set<string>;
  onSort: (key: ColumnKey) => void;
  onToggle: (id: string, shift: boolean) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
}

export default function RegistrationsTable({ rows, columns, lang, sort, selected, onSort, onToggle, onToggleAll, onOpen }: Props) {
  const headRef = useRef<HTMLInputElement>(null);
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const someSelected = rows.some(r => selected.has(r.id));

  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th className="check">
              <input ref={headRef} type="checkbox" checked={allSelected} onChange={onToggleAll} title="Seleccionar todo lo filtrado" />
            </th>
            {columns.map(c => (
              <th key={c.key} className="sortable" onClick={() => onSort(c.key)}>
                {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Sin registros que coincidan.</td></tr>
          )}
          {rows.map(r => (
            <tr key={r.id} className={`clickable ${selected.has(r.id) ? 'selected' : ''}`} onClick={() => onOpen(r.id)}>
              <td className="check" onClick={e => { e.stopPropagation(); onToggle(r.id, (e.nativeEvent as MouseEvent).shiftKey); }}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => {}} onClick={e => { e.stopPropagation(); onToggle(r.id, (e.nativeEvent as MouseEvent).shiftKey); }} />
              </td>
              {columns.map(c => (
                <td key={c.key} className="cell" title={cellText(r, c, lang)}>
                  {c.key === 'status' ? (
                    <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  ) : c.key === 'tags' ? (
                    r.tags.map(t => <span key={t} className="tag-chip">{t}</span>)
                  ) : c.key === 'name' ? (
                    <span style={{ fontWeight: 600 }}>{r.name || <span className="text-muted">Sin nombre</span>}</span>
                  ) : (
                    cellText(r, c, lang)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
