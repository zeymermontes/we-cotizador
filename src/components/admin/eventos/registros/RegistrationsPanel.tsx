import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../hooks/useAuth';
import type { EventRow } from '../../../../lib/events-types';
import { type FormSchema, type Lang, normalizeSchema } from '../../../../lib/form-types';
import {
  type Registration, type RegistrationStatus, type ViewConfig, type ColumnKey,
  DEFAULT_VIEW, STATUS_ORDER, STATUS_LABEL, allColumns, applyView, toCsv, downloadFile, expandColumns, ALL_ANSWERS,
  type Registration as RegistrationRow,
} from '../../../../lib/registrations';
import { downloadAnswersExcel } from '../../../../lib/export';
import FilterBar from './FilterBar';
import RegistrationsTable from './RegistrationsTable';
import RegistrationDrawer from './RegistrationDrawer';

interface SavedView { id: string; name: string; config: ViewConfig }

export interface BulkContext {
  event: EventRow;
  schema: FormSchema | null;
  selected: Registration[];
  filtered: Registration[];
  all: Registration[];
  refresh: () => Promise<void>;
  clearSelection: () => void;
}

interface Props {
  event: EventRow;
  /** Acciones extra en la barra de selección (correo, QR, invitaciones…). */
  extraBulkActions?: (ctx: BulkContext) => ReactNode;
  /** Botones extra en la barra superior. */
  extraToolbar?: (ctx: BulkContext) => ReactNode;
}

export default function RegistrationsPanel({ event, extraBulkActions, extraToolbar }: Props) {
  const { session } = useAuth();
  const lang: Lang = event.default_language;

  const [regs, setRegs] = useState<Registration[]>([]);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [view, setView] = useState<ViewConfig>(DEFAULT_VIEW);
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const lastClick = useRef<string | null>(null);

  // ─── Carga inicial ─────────────────────────────────────────
  const loadAll = useCallback(async () => {
    const [{ data: rows }, { data: form }, { data: sv }] = await Promise.all([
      supabase.from('registrations').select('*').eq('event_id', event.id).order('created_at', { ascending: false }),
      supabase.from('event_forms').select('draft, published_version').eq('event_id', event.id).maybeSingle(),
      supabase.from('saved_views').select('id, name, config').eq('event_id', event.id).order('created_at'),
    ]);
    setRegs((rows as Registration[]) ?? []);
    setViews(((sv ?? []) as SavedView[]).map(v => ({ ...v, config: { ...DEFAULT_VIEW, ...v.config } })));
    if (form?.published_version) {
      const { data: ver } = await supabase.from('form_versions').select('schema').eq('event_id', event.id).eq('version', form.published_version).maybeSingle();
      setSchema(normalizeSchema(ver?.schema ?? form.draft));
    } else {
      setSchema(form ? normalizeSchema(form.draft) : null);
    }
    setLoading(false);
  }, [event.id]);

  useEffect(() => {
    (async () => { await loadAll(); })();
  }, [loadAll]);

  // ─── En vivo ───────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`registrations:${event.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `event_id=eq.${event.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as Registration;
          setRegs(prev => (prev.some(r => r.id === row.id) ? prev : [row, ...prev]));
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as Registration;
          setRegs(prev => prev.map(r => (r.id === row.id ? row : r)));
        } else if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id: string }).id;
          setRegs(prev => prev.filter(r => r.id !== id));
          setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
        }
      })
      .subscribe(status => setLive(status === 'SUBSCRIBED'));
    return () => { supabase.removeChannel(channel); };
  }, [event.id]);

  // ─── Derivados ─────────────────────────────────────────────
  const columns = useMemo(() => allColumns(schema, lang), [schema, lang]);
  const visibleColumns = useMemo(() => expandColumns(view.columns, columns), [view.columns, columns]);
  const allAnswers = view.columns.includes(ALL_ANSWERS);
  const questionKeys = useMemo(() => columns.filter(c => c.question).map(c => c.key), [columns]);
  /** Quitar una pregunta cuando están "todas": se vuelven explícitas menos esa. */
  const toggleColumn = (key: ColumnKey) => setView(v => {
    const cols = v.columns.includes(ALL_ANSWERS) && key.startsWith('q:') ? [...v.columns.filter(k => k !== ALL_ANSWERS), ...questionKeys] : v.columns;
    return { ...v, columns: cols.includes(key) ? cols.filter(k => k !== key) : [...cols, key] };
  });
  const filtered = useMemo(() => applyView(regs, view, schema, lang), [regs, view, schema, lang]);
  const selectedInFiltered = filtered.filter(r => selected.has(r.id)).length;
  const selectedRows = useMemo(() => regs.filter(r => selected.has(r.id)), [regs, selected]);
  const activeView = views.find(v => v.id === activeViewId);
  const viewDirty = activeView ? JSON.stringify(activeView.config) !== JSON.stringify(view) : false;
  const people = filtered.reduce((s, r) => s + (r.status === 'cancelled' ? 0 : r.party_size ?? 1), 0);

  const ctx: BulkContext = {
    event, schema, selected: selectedRows, filtered, all: regs,
    refresh: loadAll,
    clearSelection: () => setSelected(new Set()),
  };

  // ─── Selección ─────────────────────────────────────────────
  const toggle = (id: string, shift: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (shift && lastClick.current) {
        const ids = filtered.map(r => r.id);
        const a = ids.indexOf(lastClick.current); const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a];
          const adding = !prev.has(id);
          for (let i = from; i <= to; i++) { if (adding) next.add(ids[i]); else next.delete(ids[i]); }
          lastClick.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      lastClick.current = id;
      return next;
    });
  };

  const toggleAll = () => {
    const all = filtered.every(r => selected.has(r.id));
    setSelected(prev => {
      const next = new Set(prev);
      filtered.forEach(r => (all ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  };

  // ─── Acciones masivas ──────────────────────────────────────
  async function bulkStatus(status: RegistrationStatus) {
    if (!status || selected.size === 0) return;
    if (!confirm(`¿Cambiar ${selected.size} registro(s) a "${STATUS_LABEL[status]}"?`)) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { error } = await supabase.from('registrations').update({ status }).in('id', ids);
    setBulkBusy(false);
    if (error) return alert(error.message);
    setRegs(prev => prev.map(r => (selected.has(r.id) ? { ...r, status } : r)));
  }

  async function bulkTagApply(remove: boolean) {
    const t = bulkTag.trim();
    if (!t || selected.size === 0) return;
    setBulkBusy(true);
    const updates = selectedRows
      .filter(r => (remove ? r.tags.includes(t) : !r.tags.includes(t)))
      .map(r => ({ id: r.id, tags: remove ? r.tags.filter(x => x !== t) : [...r.tags, t] }));
    await Promise.all(updates.map(u => supabase.from('registrations').update({ tags: u.tags }).eq('id', u.id)));
    setRegs(prev => prev.map(r => { const u = updates.find(x => x.id === r.id); return u ? { ...r, tags: u.tags } : r; }));
    setBulkBusy(false);
    setBulkTag('');
  }

  async function bulkDelete() {
    if (!confirm(`¿Eliminar ${selected.size} registro(s)? No se puede deshacer.`)) return;
    if (!confirm('Última confirmación: ¿eliminar?')) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { error } = await supabase.from('registrations').delete().in('id', ids);
    setBulkBusy(false);
    if (error) return alert(error.message);
    setRegs(prev => prev.filter(r => !selected.has(r.id)));
    setSelected(new Set());
  }

  // ─── Vistas guardadas ──────────────────────────────────────
  async function saveView(asNew: boolean) {
    if (asNew || !activeView) {
      const name = prompt('Nombre de la vista:', view.filters.length ? 'Filtro' : 'Vista');
      if (!name) return;
      const { data, error } = await supabase.from('saved_views').insert({ event_id: event.id, name, config: view, created_by: session?.user.id ?? null }).select('id, name, config').single();
      if (error) return alert(error.message);
      setViews(v => [...v, data as SavedView]);
      setActiveViewId(data.id);
    } else {
      const { error } = await supabase.from('saved_views').update({ config: view }).eq('id', activeView.id);
      if (error) return alert(error.message);
      setViews(v => v.map(x => (x.id === activeView.id ? { ...x, config: view } : x)));
    }
  }

  async function deleteView() {
    if (!activeView || !confirm(`¿Eliminar la vista "${activeView.name}"?`)) return;
    await supabase.from('saved_views').delete().eq('id', activeView.id);
    setViews(v => v.filter(x => x.id !== activeView.id));
    setActiveViewId('');
  }

  const exportCsv = (rows: Registration[], suffix: string) => {
    const cols = allColumns(schema, lang);
    // BOM para que Excel abra los acentos bien
    downloadFile(`${event.slug}-registros-${suffix}.csv`, '\ufeff' + toCsv(rows, cols, lang));
  };
  const exportAnswers = (rows: RegistrationRow[], suffix: string) => downloadAnswersExcel(event, schema, rows, lang, suffix);

  const setSort = (key: ColumnKey) =>
    setView(v => ({ ...v, sort: { key, dir: v.sort.key === key && v.sort.dir === 'asc' ? 'desc' : 'asc' } }));

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Cargando registros…</div>;

  const openReg = openId ? regs.find(r => r.id === openId) ?? null : null;

  return (
    <div>
      <div className="reg-toolbar">
        <input
          className="search-input"
          placeholder="Buscar nombre, correo, teléfono, respuesta…"
          value={view.search}
          onChange={e => setView(v => ({ ...v, search: e.target.value }))}
        />
        <select
          className="glass-select views-select"
          value={activeViewId}
          onChange={e => {
            const v = views.find(x => x.id === e.target.value);
            setActiveViewId(e.target.value);
            setView(v ? v.config : DEFAULT_VIEW);
          }}
        >
          <option value="">Vista: todos</option>
          {views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {(view.filters.length > 0 || view.search || activeView) && (
          <>
            {activeView && viewDirty && <button className="btn btn-secondary btn-xs" onClick={() => saveView(false)}>Guardar cambios</button>}
            <button className="btn btn-ghost btn-xs" onClick={() => saveView(true)}>{activeView ? 'Guardar como…' : 'Guardar vista'}</button>
            {activeView && <button className="btn btn-ghost btn-xs" onClick={deleteView}>Eliminar vista</button>}
          </>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <button className="btn btn-secondary btn-xs" onClick={() => setShowColumns(s => !s)}>Columnas</button>
          {showColumns && (
            <div className="columns-menu" onMouseLeave={() => setShowColumns(false)}>
              <div className="menu-group">DATOS</div>
              {columns.filter(c => !c.question).map(c => (
                <label key={c.key}><input type="checkbox" checked={view.columns.includes(c.key)} onChange={() => toggleColumn(c.key)} />{c.label}</label>
              ))}
              {columns.some(c => c.question) && (
                <>
                  <div className="menu-group">PREGUNTAS</div>
                  <label style={{ fontWeight: 600 }}>
                    <input type="checkbox" checked={allAnswers} onChange={() => setView(v => ({ ...v, columns: allAnswers ? v.columns.filter(k => k !== ALL_ANSWERS && !k.startsWith('q:')) : [...v.columns.filter(k => !k.startsWith('q:')), ALL_ANSWERS] }))} />
                    Todas las respuestas (al final)
                  </label>
                </>
              )}
              {columns.filter(c => c.question).map(c => (
                <label key={c.key}><input type="checkbox" checked={allAnswers || view.columns.includes(c.key)} onChange={() => toggleColumn(c.key)} />{c.label}</label>
              ))}
            </div>
          )}
        </div>
        <button className="btn btn-secondary btn-xs" onClick={() => exportAnswers(filtered, 'filtrados')} disabled={filtered.length === 0} title="Excel con todas las respuestas del formulario y los datos del registro">⬇ Exportar respuestas</button>
        <button className="btn btn-ghost btn-xs" onClick={() => exportCsv(filtered, 'filtrados')} disabled={filtered.length === 0} title="CSV con las columnas de la tabla">CSV</button>
        <button className="btn btn-primary btn-xs" onClick={() => setShowManual(true)}>+ Manual</button>
        {extraToolbar?.(ctx)}
      </div>

      <FilterBar view={view} columns={columns} lang={lang} onChange={setView} />

      <div className="reg-counts">
        <span><span className={live ? 'live-dot' : ''} />{live ? 'En vivo' : 'Conectando…'}</span>
        <span><b>{filtered.length}</b> de <b>{regs.length}</b> registros{filtered.length !== regs.length ? ' (filtrados)' : ''} · <b>{people}</b> personas</span>
        {selected.size > 0 && (
          <span><b>{selected.size}</b> seleccionados{selectedInFiltered !== selected.size ? ` (${selectedInFiltered} visibles en este filtro)` : ''}</span>
        )}
        {filtered.length > 0 && selectedInFiltered < filtered.length && (
          <button className="btn btn-ghost btn-xs" onClick={toggleAll}>Seleccionar los {filtered.length} filtrados</button>
        )}
      </div>

      <RegistrationsTable
        rows={filtered}
        columns={visibleColumns}
        lang={lang}
        sort={view.sort}
        selected={selected}
        onSort={setSort}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onOpen={setOpenId}
      />

      {selected.size > 0 && (
        <div className="bulk-bar">
          <b>{selected.size} seleccionado{selected.size === 1 ? '' : 's'}</b>
          <select className="glass-select" value="" disabled={bulkBusy} onChange={e => bulkStatus(e.target.value as RegistrationStatus)}>
            <option value="">Cambiar estatus…</option>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <input className="input-field" placeholder="Etiqueta" value={bulkTag} onChange={e => setBulkTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') bulkTagApply(false); }} />
          <button className="btn btn-secondary btn-xs" disabled={!bulkTag.trim() || bulkBusy} onClick={() => bulkTagApply(false)}>+ etiqueta</button>
          <button className="btn btn-ghost btn-xs" disabled={!bulkTag.trim() || bulkBusy} onClick={() => bulkTagApply(true)}>− etiqueta</button>
          <button className="btn btn-secondary btn-xs" onClick={() => exportAnswers(selectedRows, 'seleccionados')}>⬇ Respuestas</button>
          <button className="btn btn-ghost btn-xs" onClick={() => exportCsv(selectedRows, 'seleccionados')}>CSV</button>
          {extraBulkActions?.(ctx)}
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-xs" onClick={bulkDelete} disabled={bulkBusy}>Eliminar</button>
          <button className="btn btn-ghost btn-xs" onClick={() => setSelected(new Set())}>Deseleccionar</button>
        </div>
      )}

      {openReg && (
        <RegistrationDrawer event={event}
          registration={openReg}
          schema={schema}
          lang={lang}
          onClose={() => setOpenId(null)}
          onChanged={r => setRegs(prev => prev.map(x => (x.id === r.id ? r : x)))}
          onDeleted={id => { setRegs(prev => prev.filter(x => x.id !== id)); setOpenId(null); }}
        />
      )}

      {showManual && (
        <ManualModal
          event={event}
          onClose={() => setShowManual(false)}
          onCreated={r => { setRegs(prev => (prev.some(x => x.id === r.id) ? prev : [r, ...prev])); setShowManual(false); }}
        />
      )}
    </div>
  );
}

// ─── Registro manual ─────────────────────────────────────────

function ManualModal({ event, onClose, onCreated }: { event: EventRow; onClose: () => void; onCreated: (r: Registration) => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', party_size: 1, company: '', status: 'registered' as RegistrationStatus });
  const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.from('registrations').insert({
      event_id: event.id,
      name: f.name.trim() || null,
      email: f.email.trim().toLowerCase() || null,
      phone: f.phone.replace(/[^\d+]/g, '') || null,
      party_size: Math.max(1, Number(f.party_size) || 1),
      company: f.company.trim() || null,
      status: f.status,
      lang: event.default_language,
      source: { ref: 'manual' },
    }).select('*').single();
    setBusy(false);
    if (error) return alert(error.message);
    onCreated(data as Registration);
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={create}>
        <h2>Registro manual</h2>
        <p className="text-muted text-sm" style={{ marginBottom: 12 }}>Para invitados que no llenaron el formulario.</p>
        <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="input-group"><label className="input-label">Nombre *</label><input className="input-field" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} required autoFocus /></div>
          <div className="input-group"><label className="input-label">Personas</label><input className="input-field" type="number" min={1} value={f.party_size} onChange={e => setF(x => ({ ...x, party_size: Number(e.target.value) }))} /></div>
          <div className="input-group"><label className="input-label">Correo</label><input className="input-field" type="email" value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} /></div>
          <div className="input-group"><label className="input-label">Teléfono</label><input className="input-field" value={f.phone} onChange={e => setF(x => ({ ...x, phone: e.target.value }))} placeholder="+52…" /></div>
          <div className="input-group"><label className="input-label">Empresa</label><input className="input-field" value={f.company} onChange={e => setF(x => ({ ...x, company: e.target.value }))} /></div>
          <div className="input-group"><label className="input-label">Estatus</label>
            <select className="glass-select" value={f.status} onChange={e => setF(x => ({ ...x, status: e.target.value as RegistrationStatus }))}>
              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !f.name.trim()}>{busy ? 'Guardando…' : 'Agregar'}</button>
        </div>
      </form>
    </div>
  );
}
