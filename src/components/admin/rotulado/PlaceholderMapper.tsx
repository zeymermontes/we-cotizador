import { isMissing } from '../../../lib/labeling-types';
import type { InspectResult, PlaceholderMapping } from '../../../lib/labeling-types';

interface Props {
  inspect: InspectResult;
  map: Record<string, PlaceholderMapping>;
  onChange: (map: Record<string, PlaceholderMapping>) => void;
}

/** Valor que tomaría el marcador en la primera fila con datos. */
function preview(cfg: PlaceholderMapping, headers: string[], row: string[] | undefined) {
  if (cfg.source === 'literal') return cfg.value || '—';
  if (cfg.source === 'column') {
    const i = headers.indexOf(cfg.column ?? '');
    return i === -1 ? '(columna no encontrada)' : (row?.[i] ?? '').toString() || '(vacío)';
  }
  return '(vacío)';
}

export default function PlaceholderMapper({ inspect, map, onChange }: Props) {
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
            <th>Variable de la plantilla</th>
            <th>De dónde sale</th>
            <th>Valor</th>
            <th>Vista previa (1ª fila)</th>
          </tr>
        </thead>
        <tbody>
          {placeholders.map((ph) => {
            const cfg = map[ph] ?? { source: 'literal', value: '' };
            const missing = isMissing(cfg);
            return (
              <tr key={ph}>
                <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{ph}</td>
                <td>
                  <select
                    className="input-field"
                    style={{ padding: '6px 10px', fontSize: 'var(--text-xs)' }}
                    value={cfg.source === 'column' ? 'column' : cfg.source === 'empty' ? 'empty' : 'literal'}
                    onChange={(e) => update(ph, { source: e.target.value as PlaceholderMapping['source'] })}
                  >
                    <option value="column">Columna del Sheet</option>
                    <option value="literal">Igual para todos</option>
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
                  {(cfg.source === 'literal' || cfg.source === 'typeform') && (
                    <input
                      className="input-field"
                      style={{
                        padding: '6px 10px',
                        fontSize: 'var(--text-xs)',
                        borderColor: missing ? 'var(--color-warning)' : undefined,
                      }}
                      placeholder="Escribe el valor para todos los invitados"
                      value={cfg.value ?? ''}
                      onChange={(e) => update(ph, { source: 'literal', value: e.target.value })}
                    />
                  )}
                  {cfg.source === 'empty' && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: missing ? 'var(--color-warning)' : 'var(--text-muted)',
                    maxWidth: 260,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {missing ? 'Falta el valor' : preview(cfg, headers, firstRow)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
