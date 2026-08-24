import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { LabelingJob } from '../lib/labeling-types';
import { STATUS_BADGE, STATUS_LABEL } from '../lib/labeling-types';

export default function RotuladoPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<LabelingJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    try {
      const { data } = await supabase
        .from('labeling_jobs')
        .select('*')
        .order('created_at', { ascending: false });
      if (data) setJobs(data as LabelingJob[]);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteJob(job: LabelingJob, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar el rotulado "${job.name}"? Los PDFs ya generados en Drive no se borran.`)) return;
    const { error } = await supabase.from('labeling_jobs').delete().eq('id', job.id);
    if (error) return alert('Error al eliminar: ' + error.message);
    await loadJobs();
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar" style={{ marginBottom: 24 }}>
        <h1 className="admin-page-title">Rotulado</h1>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/admin/rotulado/nuevo')}>
          + Nuevo rotulado
        </button>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 24, maxWidth: 720 }}>
        Genera un PDF personalizado por invitado a partir de una plantilla de Google Slides, lo guarda en Drive y
        escribe la URL de vuelta en tu hoja de cálculo.
      </p>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Evento</th>
              <th>Estado</th>
              <th>Progreso</th>
              <th>Errores</th>
              <th>Creado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                  Aún no hay rotulados. Crea el primero con el botón de arriba.
                </td>
              </tr>
            )}
            {jobs.map((job) => (
              <tr key={job.id} onClick={() => navigate(`/admin/rotulado/${job.id}`)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 600 }}>{job.name}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[job.status]}`}>{STATUS_LABEL[job.status]}</span>
                </td>
                <td>
                  {job.total_rows > 0 ? `${job.processed_rows} / ${job.total_rows}` : '—'}
                </td>
                <td style={{ color: job.failed_rows ? 'var(--color-error)' : 'var(--text-muted)' }}>
                  {job.failed_rows || '—'}
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{formatDate(job.created_at)}</td>
                <td>
                  <button className="btn btn-ghost btn-xs" onClick={(e) => deleteJob(job, e)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
