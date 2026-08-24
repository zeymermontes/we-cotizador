import type { InspectResult, PlaceholderMapping } from '../../../lib/labeling-types';

interface Props {
  inspect: InspectResult;
  map: Record<string, PlaceholderMapping>;
  onChange: (map: Record<string, PlaceholderMapping>) => void;
  typeformUrl: string;
}

/** Valor que tomaría el marcador en la primera fila con datos. */
function preview(cfg: PlaceholderMapping, headers: string[], row: string[] | undefined, typeformUrl: string) {
  if (cfg.source === 'typeform') return typeformUrl || '(sin link)';
  if (cfg.source === 'literal') return cfg.value || '(vacío)';
  if (cfg.source === 'column') {
    const i = headers.indexOf(cfg.column ?? '');
    return i === -1 ? '(columna no encontrada)' : (row?.[i] ?? '').toString() || '(vacío)';
  }
  return '(vacío)';
}

export default function PlaceholderMapper({ inspect, map, onChange, typeformUrl }: Props) {
  const { headers, sample_rows } = inspect.spreadsheet;
  const firstRow = sample_rows[0];
  const placeholders = inspect.template.placeholders;

  function update(ph: string, patch: Partial<PlaceholderMapping>) {
    onChange({ ...map, [ph]: { ...map[ph], ...patch } as PlaceholderMapping });
  }

  if (!placeholders.length) {
    return (
      <p style={{ color: 'var(--color-warning)', fontSize: 'var(--text-sm)' }}>
        La plantilla no tiene marcadores <code>{'{{...}}'}</code>, así que no hay nada que sustituir.
      </p>
    );
  }

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>Marcador en la plantilla</th>
            <th>De dónde sale</th>
            <th>Valor</th>
            <th>Vista previa (1ª fila)</th>
          </tr>
        </thead>
        <tbody>
          {placeholders.map((ph) => {
            const cfg = map[ph] ?? { source: 'empty' };
            const unmapped = cfg.source === 'empty';
            return (
              <tr key={ph}>
                <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{ph}</td>
                <td>
                  <select
                    className="input-field"
                    style={{ padding: '6px 10px', fontSize: 'var(--text-xs)' }}
                    value={cfg.source}
                    onChange={(e) => update(ph, { source: e.target.value as PlaceholderMapping['source'] })}
                  >
                    <option value="column">Columna del Sheet</option>
                    <option value="typeform">Link de Typeform</option>
                    <option value="literal">Valor fijo</option>
                    <option value="empty">Dejar vacío</option>
                  </select>
                </td>
                <td>
                  {cfg.source === 'column' && (
                    <select
                      className="input-field"
                      style={{ padding: '6px 10px', fontSize: 'var(--text-xs)' }}
                      value={cfg.column ?? ''}
                      onChange={(e) => update(ph, { column: e.target.value })}
                    >
                      <option value="">— Elige una columna —</option>
                      {headers.filter(Boolean).map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  )}
                  {cfg.source === 'literal' && (
                    <input
                      className="input-field"
                      style={{ padding: '6px 10px', fontSize: 'var(--text-xs)' }}
                      value={cfg.value ?? ''}
                      onChange={(e) => update(ph, { value: e.target.value })}
                    />
                  )}
                  {cfg.source === 'typeform' && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>igual para todos</span>
                  )}
                  {cfg.source === 'empty' && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: unmapped ? 'var(--color-warning)' : 'var(--text-muted)',
                    maxWidth: 260,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {preview(cfg, headers, firstRow, typeformUrl)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
