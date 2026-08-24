import type { LabelingJob } from '../../../lib/labeling-types';

interface Props {
  job: LabelingJob;
  stalled: boolean;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onDryRun: () => void;
}

export default function JobProgress({ job, stalled, busy, onStart, onPause, onDryRun }: Props) {
  const total = job.total_rows || 0;
  const pct = total ? Math.round((job.processed_rows / total) * 100) : 0;
  const running = job.status === 'running';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
          {total ? `${job.processed_rows} de ${total} invitados` : 'Sin ejecutar todavía'}
          {job.failed_rows > 0 && (
            <span style={{ color: 'var(--color-error)', fontWeight: 400 }}> · {job.failed_rows} con error</span>
          )}
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{pct}%</span>
      </div>

      <div className="progress-bar" style={{ height: 6, marginBottom: 20 }}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {running && !stalled && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 16 }}>
          Generando… puedes cerrar esta pestaña: el proceso sigue en el servidor.
        </p>
      )}

      {stalled && (
        <div
          style={{
            background: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
            marginBottom: 16,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-warning)',
          }}
        >
          ⚠️ El proceso lleva varios minutos sin avanzar. Pulsa <strong>Reanudar</strong>: las filas que ya tienen PDF
          se saltan solas.
        </div>
      )}

      {job.last_error && (
        <div
          style={{
            background: 'rgba(248, 113, 113, 0.1)',
            border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
            marginBottom: 16,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-error)',
          }}
        >
          {job.last_error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {running && !stalled ? (
          <button className="btn btn-secondary btn-sm" onClick={onPause} disabled={busy}>
            Pausar
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={onStart} disabled={busy || job.status === 'completed'}>
            {job.processed_rows > 0 ? 'Reanudar' : 'Generar PDFs'}
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={onDryRun} disabled={busy || running}>
          Prueba sin generar
        </button>
        {job.output_folder_url && (
          <a className="btn btn-ghost btn-sm" href={job.output_folder_url} target="_blank" rel="noopener noreferrer">
            Abrir carpeta ↗
          </a>
        )}
        {job.spreadsheet_url && (
          <a className="btn btn-ghost btn-sm" href={job.spreadsheet_url} target="_blank" rel="noopener noreferrer">
            Abrir hoja ↗
          </a>
        )}
      </div>

      {job.row_errors?.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h4 style={{ fontSize: 'var(--text-sm)', marginBottom: 8 }}>Filas con error</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Invitado</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {job.row_errors.map((e) => (
                  <tr key={e.row}>
                    <td>{e.row}</td>
                    <td>{e.name || '—'}</td>
                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
