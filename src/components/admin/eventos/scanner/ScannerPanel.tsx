import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../../../lib/supabase';
import { publicUrls } from '../../../../lib/host';
import type { EventRow } from '../../../../lib/events-types';
import { downloadFile } from '../../../../lib/registrations';

interface CheckIn { id: string; registration_id: string; session_id: string | null; count: number; method: string; scanned_at: string }
interface Session { id: string; device_label: string | null; created_at: string; last_seen_at: string; expires_at: string; scans: number }
interface RegLite { id: string; name: string | null; party_size: number; status: string; email: string | null; phone: string | null; company: string | null }

export default function ScannerPanel({ event }: { event: EventRow }) {
  const [pin, setPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[0-9]{4,8}$/.test(pin)) { setPinMsg({ ok: false, text: 'El PIN debe tener entre 4 y 8 dígitos.' }); return; }
    setSavingPin(true);
    const { error } = await supabase.rpc('set_event_scanner_pin', { p_event_id: event.id, p_pin: pin });
    setSavingPin(false);
    if (error) { setPinMsg({ ok: false, text: error.message }); return; }
    setPin('');
    setPinMsg({ ok: true, text: 'PIN actualizado. Los dispositivos ya conectados siguen activos.' });
  }
  const [regs, setRegs] = useState<RegLite[]>([]);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [live, setLive] = useState(false);
  const urls = publicUrls(event.slug);

  const load = useCallback(async () => {
    const [{ data: r }, { data: c }, { data: s }] = await Promise.all([
      supabase.from('registrations').select('id, name, party_size, status, email, phone, company').eq('event_id', event.id).neq('status', 'cancelled'),
      supabase.from('check_ins').select('*').eq('event_id', event.id).order('scanned_at', { ascending: false }),
      supabase.from('scanner_sessions').select('id, device_label, created_at, last_seen_at, expires_at, scans').eq('event_id', event.id).order('last_seen_at', { ascending: false }).limit(20),
    ]);
    setRegs((r as RegLite[]) ?? []); setCheckIns((c as CheckIn[]) ?? []); setSessions((s as Session[]) ?? []);
  }, [event.id]);

  useEffect(() => {
    (async () => { await load(); })();
    const ch = supabase.channel(`check_ins:${event.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins', filter: `event_id=eq.${event.id}` }, () => { load(); })
      .subscribe(st => setLive(st === 'SUBSCRIBED'));
    return () => { supabase.removeChannel(ch); };
  }, [event.id, load]);

  const names = useMemo(() => new Map(regs.map(r => [r.id, r])), [regs]);
  const expectedPeople = regs.reduce((s, r) => s + (r.party_size ?? 1), 0);
  const enteredPeople = checkIns.reduce((s, c) => s + c.count, 0);
  const enteredRegs = new Set(checkIns.map(c => c.registration_id)).size;
  const invitedRegs = regs.filter(r => ['invited', 'confirmed', 'checked_in'].includes(r.status)).length;
  const pct = expectedPeople ? Math.round((enteredPeople / expectedPeople) * 100) : 0;

  // Línea de tiempo por hora
  const byHour = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of checkIns) {
      const d = new Date(c.scanned_at);
      const k = `${String(d.getHours()).padStart(2, '0')}:00`;
      m.set(k, (m.get(k) ?? 0) + c.count);
    }
    return Array.from(m.entries()).sort();
  }, [checkIns]);
  const maxHour = Math.max(1, ...byHour.map(([, n]) => n));

  function exportAttendance() {
    const entered = new Map<string, { count: number; at: string }>();
    for (const c of checkIns) {
      const cur = entered.get(c.registration_id);
      entered.set(c.registration_id, { count: (cur?.count ?? 0) + c.count, at: cur?.at ?? c.scanned_at });
    }
    const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['Nombre', 'Correo', 'Teléfono', 'Empresa', 'Personas', 'Estatus', 'Entraron', 'Hora de entrada'].map(esc).join(',')];
    for (const r of regs) {
      const e = entered.get(r.id);
      lines.push([r.name ?? '', r.email ?? '', r.phone ?? '', r.company ?? '', String(r.party_size), r.status, String(e?.count ?? 0), e ? new Date(e.at).toLocaleString('es-MX') : ''].map(esc).join(','));
    }
    downloadFile(`${event.slug}-asistencia.csv`, '﻿' + lines.join('\r\n'));
  }

  async function removeSession(id: string) {
    if (!confirm('¿Cerrar esta sesión del scanner? El dispositivo tendrá que volver a escribir el PIN.')) return;
    await supabase.from('scanner_sessions').delete().eq('id', id);
    load();
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <div className="reg-counts" style={{ marginBottom: 12 }}>
        <span><span className={live ? 'live-dot' : ''} />{live ? 'En vivo' : 'Conectando…'}</span>
        <span>Scanner: <code>{urls.acceso}</code></span>
        <a className="btn btn-ghost btn-xs" href={urls.acceso} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-xs" onClick={exportAttendance} disabled={regs.length === 0}>Exportar asistencia</button>
      </div>

      <form className="section-card" onSubmit={savePin} style={{ marginBottom: 20 }}>
        <h3>PIN del scanner</h3>
        <p className="section-hint">
          El staff lo escribe en <code>{urls.acceso}</code> para empezar a escanear. Solo dígitos, de 4 a 8. No se puede ver, solo cambiar.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input-field"
            style={{ maxWidth: 200, letterSpacing: '0.2em' }}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setPinMsg(null); }}
            placeholder="Nuevo PIN"
          />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={savingPin || pin.length < 4}>
            {savingPin ? 'Guardando...' : 'Cambiar PIN'}
          </button>
          {pinMsg && <span className={`text-xs ${pinMsg.ok ? 'text-muted' : ''}`} style={pinMsg.ok ? undefined : { color: 'var(--color-error)' }}>{pinMsg.text}</span>}
        </div>
      </form>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-label">Personas dentro</div><div className="stat-value">{enteredPeople}</div><div className="text-muted text-xs">de {expectedPeople} esperadas · {pct}%</div></div>
        <div className="stat-card"><div className="stat-label">Registros que llegaron</div><div className="stat-value">{enteredRegs}</div><div className="text-muted text-xs">de {regs.length} activos</div></div>
        <div className="stat-card"><div className="stat-label">Invitados / confirmados</div><div className="stat-value">{invitedRegs}</div><div className="text-muted text-xs">{invitedRegs ? Math.round((enteredRegs / invitedRegs) * 100) : 0}% llegaron</div></div>
        <div className="stat-card"><div className="stat-label">Escaneos</div><div className="stat-value">{checkIns.length}</div><div className="text-muted text-xs">{sessions.length} dispositivos</div></div>
      </div>

      <div className="field-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="section-card">
          <h3>Últimos accesos</h3>
          {checkIns.length === 0 ? <p className="text-muted text-sm">Nadie ha entrado todavía.</p> : (
            <div>
              {checkIns.slice(0, 30).map(c => {
                const r = names.get(c.registration_id);
                return (
                  <div key={c.id} className="member-row">
                    <div className="member-main">
                      <div style={{ fontWeight: 500 }}>{r?.name || '—'}</div>
                      <div className="member-email">{r?.company ?? ''}{c.count > 1 ? ` · ${c.count} personas` : ''}{c.method === 'manual' ? ' · manual' : ''}</div>
                    </div>
                    <span className="text-muted text-sm">{time(c.scanned_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="section-card">
            <h3>Llegadas por hora</h3>
            {byHour.length === 0 ? <p className="text-muted text-sm">Sin datos aún.</p> : (
              <div className="hour-bars">
                {byHour.map(([h, n]) => (
                  <div key={h} className="hour-bar" title={`${n} personas`}>
                    <div className="hour-bar-fill" style={{ height: `${Math.max(6, (n / maxHour) * 100)}%` }} />
                    <span className="hour-bar-label">{h}</span>
                    <span className="hour-bar-n">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="section-card">
            <h3>Dispositivos con sesión</h3>
            <p className="section-hint">Cada teléfono que escribió el PIN. Ciérralos al terminar el evento.</p>
            {sessions.length === 0 ? <p className="text-muted text-sm">Ninguno todavía.</p> : sessions.map(s => (
              <div key={s.id} className="member-row">
                <div className="member-main">
                  <div style={{ fontWeight: 500 }}>{s.device_label || 'Sin nombre'}</div>
                  <div className="member-email">{s.scans} escaneos · visto {time(s.last_seen_at)} · expira {new Date(s.expires_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</div>
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => removeSession(s.id)}>Cerrar</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
