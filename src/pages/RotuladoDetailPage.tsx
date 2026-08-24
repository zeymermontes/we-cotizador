import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { inspect as inspectSources, dryRun, startBatch } from '../lib/labeling-api';
import type {
  DryRunResult,
  FunctionError,
  InspectResult,
  LabelingJob,
  PlaceholderMapping,
} from '../lib/labeling-types';
import { STATUS_BADGE, STATUS_LABEL } from '../lib/labeling-types';
import PlaceholderMapper from '../components/admin/rotulado/PlaceholderMapper';
import JobProgress from '../components/admin/rotulado/JobProgress';

const STALLED_MS = 3 * 60_000;

interface QuotationOption {
  id: string;
  client: { name: string; event_type: string } | null;
}

interface FormState {
  name: string;
  spreadsheet_url: string;
  output_folder_url: string;
  template_url: string;
  typeform_url: string;
  sheet_title: string;
  header_row: number;
  quotation_id: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  spreadsheet_url: '',
  output_folder_url: '',
  template_url: '',
  typeform_url: '',
  sheet_title: '',
  header_row: 1,
  quotation_id: '',
};

export default function RotuladoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'nuevo';

  const [job, setJob] = useState<LabelingJob | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [editing, setEditing] = useState(isNew);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [quotations, setQuotations] = useState<{ id: string; label: string }[]>([]);

  const [result, setResult] = useState<InspectResult | null>(null);
  const [map, setMap] = useState<Record<string, PlaceholderMapping>>({});
  const [nameColumn, setNameColumn] = useState('');
  const [fileNameTemplate, setFileNameTemplate] = useState('{{nombre}}');
  const [pdfUrlColumn, setPdfUrlColumn] = useState('PDF URL');

  const [error, setError] = useState<{ message: string; email?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const [stalled, setStalled] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadJob = useCallback(async () => {
    if (isNew || !id) return;
    const { data } = await supabase.from('labeling_jobs').select('*').eq('id', id).single();
    if (data) {
      const j = data as LabelingJob;
      setJob(j);
      setForm({
        name: j.name,
        spreadsheet_url: j.spreadsheet_url ?? '',
        output_folder_url: j.output_folder_url ?? '',
        template_url: j.template_url ?? '',
        typeform_url: j.typeform_url ?? '',
        sheet_title: j.sheet_title ?? '',
        header_row: j.header_row,
        quotation_id: j.quotation_id ?? '',
      });
      setMap(j.placeholder_map ?? {});
      setNameColumn(j.name_column ?? '');
      setFileNameTemplate(j.file_name_template);
      setPdfUrlColumn(j.pdf_url_column);
      // "Sin avance desde hace rato": el auto-encadenado del servidor se rompió
      setStalled(j.status === 'running' && Date.now() - new Date(j.updated_at).getTime() > STALLED_MS);
    }
    setLoading(false);
  }, [id, isNew]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  useEffect(() => {
    supabase
      .from('quotations')
      .select('id, client:clients(name, event_type)')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (!data) return;
        setQuotations(
          (data as unknown as QuotationOption[]).map((q) => ({
            id: q.id,
            label: `${q.client?.name ?? 'Sin cliente'} — ${q.client?.event_type ?? ''}`.trim(),
          })),
        );
      });
  }, []);

  // Polling mientras el servidor procesa lotes
  useEffect(() => {
    if (job?.status !== 'running') {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return;
    }
    pollRef.current = window.setInterval(loadJob, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job?.status, loadJob]);

  async function handleInspect() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await inspectSources({
        spreadsheet_url: form.spreadsheet_url,
        sheet_title: form.sheet_title || null,
        header_row: form.header_row,
        template_url: form.template_url,
        output_folder_url: form.output_folder_url,
        typeform_url: form.typeform_url,
      });

      if (!('ok' in res) || res.ok === false) {
        const err = res as FunctionError;
        setError({ message: err.message, email: err.service_account_email });
        return;
      }

      setResult(res);
      // Al reconfigurar un job existente, conservar el mapeo ya guardado
      const merged = { ...res.suggested_map, ...map };
      setMap(
        Object.fromEntries(res.template.placeholders.map((ph) => [ph, merged[ph] ?? { source: 'empty' }])) as Record<
          string,
          PlaceholderMapping
        >,
      );
      if (!nameColumn) setNameColumn(res.spreadsheet.headers.find(Boolean) ?? '');
      if (!form.sheet_title) setForm((f) => ({ ...f, sheet_title: res.spreadsheet.selected_tab }));
      if (!form.name) setForm((f) => ({ ...f, name: res.spreadsheet.title }));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        quotation_id: form.quotation_id || null,
        name: form.name || result.spreadsheet.title,
        spreadsheet_id: result.spreadsheet.id,
        spreadsheet_url: form.spreadsheet_url,
        sheet_title: form.sheet_title || result.spreadsheet.selected_tab,
        header_row: form.header_row,
        output_folder_id: result.folder.id,
        output_folder_url: form.output_folder_url,
        template_id: result.template.id,
        template_url: form.template_url,
        typeform_url: form.typeform_url || null,
        placeholder_map: map,
        file_name_template: fileNameTemplate,
        name_column: nameColumn || null,
        pdf_url_column: pdfUrlColumn || 'PDF URL',
        status: 'ready' as const,
      };

      if (isNew) {
        const { data, error: insErr } = await supabase.from('labeling_jobs').insert(payload).select().single();
        if (insErr) throw insErr;
        navigate(`/admin/rotulado/${(data as LabelingJob).id}`, { replace: true });
      } else {
        const { error: updErr } = await supabase.from('labeling_jobs').update(payload).eq('id', id);
        if (updErr) throw updErr;
        setEditing(false);
        setResult(null);
        await loadJob();
      }
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      await supabase.from('labeling_jobs').update({ status: 'running', last_error: null }).eq('id', job.id);
      const res = await startBatch(job.id, crypto.randomUUID());
      if (res && 'ok' in res && res.ok === false) setError({ message: (res as FunctionError).message });
      await loadJob();
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!job) return;
    setBusy(true);
    await supabase.from('labeling_jobs').update({ status: 'paused' }).eq('id', job.id);
    await loadJob();
    setBusy(false);
  }

  async function handleDryRun() {
    if (!job) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await dryRun(job.id);
      if ('ok' in res && res.ok === false) setError({ message: (res as FunctionError).message });
      else setPreview(res as DryRunResult);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>Cargando...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div className="admin-topbar" style={{ marginBottom: 24 }}>
        <div>
          <button className="btn btn-ghost btn-xs" onClick={() => navigate('/admin/rotulado')}>
            ← Rotulado
          </button>
          <h1 className="admin-page-title" style={{ marginTop: 4 }}>
            {isNew ? 'Nuevo rotulado' : job?.name}
          </h1>
        </div>
        {job && <span className={`badge ${STATUS_BADGE[job.status]}`}>{STATUS_LABEL[job.status]}</span>}
      </div>

      {error && (
        <div
          className="glass-card"
          style={{ borderColor: 'var(--color-error)', marginBottom: 24, padding: 16, fontSize: 'var(--text-sm)' }}
        >
          <strong style={{ color: 'var(--color-error)' }}>No pude continuar.</strong>
          <p style={{ marginTop: 8 }}>{error.message}</p>
          {error.email && (
            <button
              className="btn btn-secondary btn-xs"
              style={{ marginTop: 12 }}
              onClick={() => navigator.clipboard.writeText(error.email!)}
            >
              Copiar {error.email}
            </button>
          )}
        </div>
      )}

      {/* ── 1. Configuración ─────────────────────────────────── */}
      {editing ? (
        <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
          <h3 style={{ marginBottom: 16 }}>1. Fuentes</h3>

          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <label className="input-label">Hoja de cálculo con los invitados</label>
              <input
                className="input-field"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={form.spreadsheet_url}
                onChange={(e) => setForm({ ...form, spreadsheet_url: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Plantilla de la invitación (Google Slides)</label>
              <input
                className="input-field"
                placeholder="https://docs.google.com/presentation/d/..."
                value={form.template_url}
                onChange={(e) => setForm({ ...form, template_url: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Carpeta de salida en Drive</label>
              <input
                className="input-field"
                placeholder="https://drive.google.com/drive/folders/..."
                value={form.output_folder_url}
                onChange={(e) => setForm({ ...form, output_folder_url: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Link de Typeform (uno por evento)</label>
              <input
                className="input-field"
                placeholder="https://form.typeform.com/to/..."
                value={form.typeform_url}
                onChange={(e) => setForm({ ...form, typeform_url: e.target.value })}
              />
            </div>

            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                Opciones avanzadas
              </summary>
              <div style={{ display: 'grid', gap: 16, marginTop: 16, gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <label className="input-label">Nombre del rotulado</label>
                  <input
                    className="input-field"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="input-label">Fila de encabezados</label>
                  <input
                    className="input-field"
                    type="number"
                    min={1}
                    value={form.header_row}
                    onChange={(e) => setForm({ ...form, header_row: Number(e.target.value) || 1 })}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="input-label">Ligar a una cotización (opcional)</label>
                  <select
                    className="input-field"
                    value={form.quotation_id}
                    onChange={(e) => setForm({ ...form, quotation_id: e.target.value })}
                  >
                    <option value="">— Sin ligar —</option>
                    {quotations.map((q) => (
                      <option key={q.id} value={q.id}>{q.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </details>
          </div>

          <button className="btn btn-primary btn-sm" style={{ marginTop: 20 }} onClick={handleInspect} disabled={busy}>
            {busy ? 'Leyendo…' : 'Validar y leer'}
          </button>
          {!isNew && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 20, marginLeft: 12 }}
              onClick={() => { setEditing(false); setResult(null); setError(null); }}
            >
              Cancelar
            </button>
          )}
        </div>
      ) : (
        job && (
          <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Fuentes</h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setEditing(true)}>Editar</button>
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', display: 'grid', gap: 6 }}>
              <div>Hoja: <strong>{job.sheet_title}</strong> · encabezados en la fila {job.header_row}</div>
              <div>Columna de nombre: <strong>{job.name_column || '(primera)'}</strong> · URL en <strong>{job.pdf_url_column}</strong></div>
              <div>Archivo: <strong>{job.file_name_template}</strong></div>
              {job.typeform_url && <div>Typeform: {job.typeform_url}</div>}
            </div>
          </div>
        )
      )}

      {/* ── 2. Mapeo ─────────────────────────────────────────── */}
      {editing && result && (
        <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
          <h3 style={{ marginBottom: 4 }}>2. Qué va en cada marcador</h3>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 16 }}>
            {result.spreadsheet.data_row_count} invitados en «{result.spreadsheet.selected_tab}» ·{' '}
            {result.template.placeholders.length} marcadores en la plantilla
          </p>

          {result.warnings.map((w) => (
            <p key={w} style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)', marginBottom: 8 }}>⚠️ {w}</p>
          ))}

          <PlaceholderMapper inspect={result} map={map} onChange={setMap} typeformUrl={form.typeform_url} />

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 20 }}>
            <div>
              <label className="input-label">Columna que identifica al invitado</label>
              <select className="input-field" value={nameColumn} onChange={(e) => setNameColumn(e.target.value)}>
                {result.spreadsheet.headers.filter(Boolean).map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="input-label">Nombre del archivo</label>
              <input className="input-field" value={fileNameTemplate} onChange={(e) => setFileNameTemplate(e.target.value)} />
            </div>
            <div>
              <label className="input-label">Columna donde escribo la URL</label>
              <input className="input-field" value={pdfUrlColumn} onChange={(e) => setPdfUrlColumn(e.target.value)} />
            </div>
          </div>

          <button className="btn btn-primary btn-sm" style={{ marginTop: 20 }} onClick={handleSave} disabled={busy}>
            {isNew ? 'Guardar y continuar' : 'Guardar cambios'}
          </button>
        </div>
      )}

      {/* ── 3. Ejecución ─────────────────────────────────────── */}
      {job && !editing && (
        <div className="glass-card" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>Generación</h3>
          <JobProgress
            job={job}
            stalled={stalled}
            busy={busy}
            onStart={handleStart}
            onPause={handlePause}
            onDryRun={handleDryRun}
          />

          {preview && (
            <div style={{ marginTop: 24 }}>
              <h4 style={{ fontSize: 'var(--text-sm)', marginBottom: 8 }}>
                Prueba — {preview.remaining} pendientes de {preview.total}
              </h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fila</th>
                      <th>Archivo que se crearía</th>
                      <th>Valores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((p) => (
                      <tr key={p.row}>
                        <td>{p.row}</td>
                        <td style={{ fontSize: 'var(--text-xs)' }}>{p.file_name}</td>
                        <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                          {Object.entries(p.values).map(([k, v]) => `${k} → ${v || '(vacío)'}`).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
