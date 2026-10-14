import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import type { EventRow } from '../../../../lib/events-types';
import { parseGuestList, createVipGuests, type GuestRow } from '../../../../lib/rsvp';

/** Pegar o subir la lista de invitados especiales: entran como "Invitado" con su enlace de confirmación. */
export default function VipImportModal({ event, onClose, onDone }: { event: EventRow; onClose: () => void; onDone: (created: number) => void }) {
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState<GuestRow[]>([]);
  const empty: GuestRow = { name: '', email: null, phone: null, party_size: 1, company: null };
  const [draft, setDraft] = useState<GuestRow>(empty);
  const rows = useMemo<GuestRow[]>(() => [...manual, ...parseGuestList(raw)], [manual, raw]);

  function addManual(e: React.FormEvent) {
    e.preventDefault();
    const g: GuestRow = {
      name: draft.name.trim(), email: draft.email?.trim().toLowerCase() || null, phone: draft.phone?.replace(/[^\d+]/g, '') || null,
      party_size: Math.max(1, Number(draft.party_size) || 1), company: draft.company?.trim() || null,
    };
    if (!g.name && !g.email && !g.phone) return;
    setManual(m => [...m, g]);
    setDraft(empty);
  }

  async function fromFile(file: File) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: '\t' });
    setRaw(csv);
  }

  async function create() {
    if (rows.length === 0) return;
    setBusy(true); setError('');
    try {
      const res = await createVipGuests(event, rows);
      onDone(res.created);
      if (res.skipped) alert(`${res.skipped} ya existían (mismo correo o teléfono) y se omitieron.`);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <h2>Agregar invitados VIP</h2>
        <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
          Escribe a los invitados uno por uno, pega la lista desde Excel (una persona por línea: nombre, correo, teléfono, personas, empresa, en cualquier orden) o sube un archivo. Entran como <b>Invitado</b> con etiqueta VIP y su enlace personal de confirmación; si está activo el envío automático, el enlace sale por correo al momento.
        </p>
        <form onSubmit={addManual} className="vip-manual">
          <div className="field-grid" style={{ gridTemplateColumns: '2fr 2fr 1.5fr 0.7fr 1.5fr auto', alignItems: 'end', gap: 10 }}>
            <div className="input-group"><label className="input-label">Nombre</label><input className="input-field" style={{ padding: '8px 0' }} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Ana López" /></div>
            <div className="input-group"><label className="input-label">Correo</label><input className="input-field" style={{ padding: '8px 0' }} type="email" value={draft.email ?? ''} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} placeholder="ana@empresa.com" /></div>
            <div className="input-group"><label className="input-label">Teléfono</label><input className="input-field" style={{ padding: '8px 0' }} value={draft.phone ?? ''} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} placeholder="+52 55…" /></div>
            <div className="input-group"><label className="input-label">Personas</label><input className="input-field" style={{ padding: '8px 0' }} type="number" min={1} value={draft.party_size} onChange={e => setDraft(d => ({ ...d, party_size: Number(e.target.value) }))} /></div>
            <div className="input-group"><label className="input-label">Empresa</label><input className="input-field" style={{ padding: '8px 0' }} value={draft.company ?? ''} onChange={e => setDraft(d => ({ ...d, company: e.target.value }))} /></div>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={!draft.name.trim() && !draft.email && !draft.phone}>+ A la lista</button>
          </div>
        </form>
        <div className="text-muted text-xs" style={{ margin: '14px 0 6px' }}>O pega varios de golpe:</div>
        <textarea className="input-field" rows={6} style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono, monospace)' }} value={raw} onChange={e => setRaw(e.target.value)} placeholder={'Ana López\tana@empresa.com\t+52 55 1234 5678\t2\tEmpresa X\nLuis Pérez\tluis@otra.com'} autoFocus />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <label className="btn btn-secondary btn-xs" style={{ cursor: 'pointer' }}>
            Subir Excel o CSV
            <input type="file" accept=".xlsx,.xls,.csv,.txt" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) fromFile(f); }} />
          </label>
          <span className="text-muted text-xs">{rows.length} {rows.length === 1 ? 'persona detectada' : 'personas detectadas'}{rows.length ? ` · ${rows.filter(r => r.email).length} con correo · ${rows.filter(r => r.phone).length} con teléfono` : ''}</span>
        </div>
        {rows.length > 0 && (
          <div className="data-table-wrapper" style={{ marginTop: 12, maxHeight: 220, overflow: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Personas</th><th>Empresa</th></tr></thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{r.name || <span className="text-muted">—</span>}</td><td>{r.email ?? ''}</td><td>{r.phone ?? ''}</td><td>{r.party_size}</td>
                    <td style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>{r.company ?? ''}</span>
                      {i < manual.length && <button type="button" className="btn btn-ghost btn-xs" title="Quitar de la lista" onClick={() => setManual(m => m.filter((_, k) => k !== i))}>✕</button>}
                    </td>
                  </tr>
                ))}
                {rows.length > 50 && <tr><td colSpan={5} className="text-muted">… y {rows.length - 50} más</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {error && <div className="inline-alert error" style={{ marginTop: 8 }}>{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={create} disabled={busy || rows.length === 0}>{busy ? 'Agregando…' : `Agregar ${rows.length} VIP`}</button>
        </div>
      </div>
    </div>
  );
}
