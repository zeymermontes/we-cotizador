import type { LabelingJob } from '../../../lib/labeling-types';
import { STATUS_LABEL } from '../../../lib/labeling-types';

interface Props {
  job: LabelingJob;
  stalled: boolean;
  busy: boolean;
  onResume: () => void;
  onRegenerate: () => void;
  onPause: () => void;
  onDryRun: () => void;
}

export default function JobProgress({ job, stalled, busy, onResume, onRegenerate, onPause, onDryRun }: Props) {
  const total = job.total_rows || 0;
  const pct = total ? Math.round((job.processed_rows / total) * 100) : 0;
  const running = job.status === 'running';
  // Se puede continuar si quedó trabajo a medias (pausado, colgado o con error)
  const canResume =
    job.processed_rows > 0 && job.processed_rows < total && (job.status !== 'running' || stalled);

  // El estado nunca se deduce: se dice. Antes había situaciones (pausado,
  // fallido) en las que la pantalla no cambiaba y parecía que seguía corriendo.
  const state = (() => {
    if (busy && !running) {
      return { title: 'Iniciando…', detail: 'Preparando la carpeta en Drive y validando la plantilla.', color: 'var(--text-muted)' };
    }
    if (job.status === 'running' && stalled) {
      return {
        title: 'Interrumpido',
        detail: 'Lleva un par de minutos sin avanzar. El servidor lo retoma solo; también puedes pulsar Reanudar.',
        color: 'var(--color-warning)',
      };
    }
    if (job.status === 'running') {
      return {
        title: 'Generando',
        detail: 'Puedes cerrar esta pestaña: el proceso vive en el servidor.',
        color: 'var(--color-warning)',
      };
    }
    if (job.status === 'paused') {
      return { title: 'Pausado', detail: 'No se está generando nada. Pulsa Reanudar para continuar.', color: 'var(--color-warning)' };
    }
    if (job.status === 'failed') {
      return { title: 'Con error', detail: 'La corrida se detuvo. Revisa el mensaje de abajo.', color: 'var(--color-error)' };
    }
    if (job.status === 'completed') {
      return { title: 'Completado', detail: `Los ${total} invitados tienen su PDF.`, color: 'var(--color-success)' };
    }
    return { title: STATUS_LABEL[job.status], detail: 'Sin ejecutar todavía.', color: 'var(--text-muted)' };
  })();

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

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          fontSize: 'var(--text-xs)',
          color: state.color,
        }}
      >
        <span style={{ fontWeight: 600 }}>{state.title}</span>
        <span style={{ color: 'var(--text-muted)' }}>{state.detail}</span>
      </div>

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
        {running && !stalled && (
          <button className="btn btn-secondary btn-sm" onClick={onPause} disabled={busy}>
            Pausar
          </button>
        )}
        {canResume && (
          <button className="btn btn-primary btn-sm" onClick={onResume} disabled={busy}>
            {busy ? 'Reanudando…' : 'Reanudar'}
          </button>
        )}
        {!running && (
          <button
            className={canResume ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
            onClick={onRegenerate}
            disabled={busy}
          >
            {busy ? 'Iniciando…' : job.output_folder_id ? 'Regenerar todo' : 'Generar PDFs'}
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
