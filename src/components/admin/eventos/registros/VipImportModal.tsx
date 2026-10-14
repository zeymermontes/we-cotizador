import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import type { EventRow } from '../../../../lib/events-types';
import { parseGuestList, createVipGuests, type GuestRow } from '../../../../lib/rsvp';

/** Pegar o subir la lista de invitados especiales: entran como "Invitado" con su enlace de confirmación. */
export default function VipImportModal({ event, onClose, onDone }: { event: EventRow; onClose: () => void; onDone: (created: number) => void }) {
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo<GuestRow[]>(() => parseGuestList(raw), [raw]);

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
          Pega la lista desde Excel (una persona por línea: nombre, correo, teléfono, personas, empresa, en cualquier orden) o sube un archivo. Entran como <b>Invitado</b> con etiqueta VIP y su enlace personal de confirmación; si está activo el envío automático, el enlace sale por correo al momento.
        </p>
        <textarea className="input-field" rows={8} style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono, monospace)' }} value={raw} onChange={e => setRaw(e.target.value)} placeholder={'Ana López\tana@empresa.com\t+52 55 1234 5678\t2\tEmpresa X\nLuis Pérez\tluis@otra.com'} autoFocus />
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
                  <tr key={i}><td>{r.name || <span className="text-muted">—</span>}</td><td>{r.email ?? ''}</td><td>{r.phone ?? ''}</td><td>{r.party_size}</td><td>{r.company ?? ''}</td></tr>
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
