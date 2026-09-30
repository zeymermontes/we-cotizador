import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import BrandedShell, { ShellMessage } from '../../components/public/BrandedShell';
import { usePublicEvent, useEventLanguage } from '../../hooks/usePublicEvent';
import { pickLocalized, type PublicEvent } from '../../lib/events-types';
import {
  type ScannerSession, type ScanResult, type ScannerGuest, type ScannerStats, type RecentCheckIn,
  loadSession, saveSession, openSession, scanCode, manualCheckIn, searchGuests, scannerStats, undoCheckIn, isFail, SCANNER_TEXT,
} from '../../lib/scanner';

export default function AccesoPage() {
  const { slug } = useParams<{ slug: string }>();
  const state = usePublicEvent(slug);
  const event = state.status === 'ready' ? state.event : null;
  const [lang, setLang] = useEventLanguage(event);
  const [session, setSession] = useState<ScannerSession | null>(() => (slug ? loadSession(slug) : null));
  const t = SCANNER_TEXT[lang];

  if (state.status === 'loading') return <BrandedShell event={null}><ShellMessage title="…" /></BrandedShell>;
  if (state.status === 'missing' || !event) return <BrandedShell event={null} title="We.Page"><ShellMessage title={lang === 'es' ? 'Este evento no está disponible' : 'This event is not available'} /></BrandedShell>;

  if (!session) {
    return (
      <BrandedShell event={event} lang={lang} onLang={setLang} title={`${t.title} · ${event.name}`}>
        <PinScreen event={event} slug={slug!} lang={lang} onOpen={s => { saveSession(slug!, s); setSession(s); }} />
      </BrandedShell>
    );
  }

  return (
    <BrandedShell event={event} lang={lang} onLang={setLang} title={`${t.title} · ${event.name}`} variant="form">
      <ScannerScreen event={event} session={session} lang={lang} onLogout={() => { saveSession(slug!, null); setSession(null); }} />
    </BrandedShell>
  );
}

// ─── PIN ─────────────────────────────────────────────────────

function PinScreen({ event, slug, lang, onOpen }: { event: PublicEvent; slug: string; lang: 'es' | 'en'; onOpen: (s: ScannerSession) => void }) {
  const t = SCANNER_TEXT[lang];
  const [pin, setPin] = useState('');
  const [device, setDevice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = pickLocalized(event.screens?.scanner?.title, lang, t.title);
  const subtitle = pickLocalized(event.screens?.scanner?.subtitle, lang, t.subtitle);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const res = await openSession(slug, pin, device);
    setBusy(false);
    if (isFail(res)) { setError(res.code === 'wrong_pin' ? t.wrong : res.message); setPin(''); return; }
    onOpen(res);
  }

  return (
    <>
      <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>{title}</h1>
      <p style={{ opacity: 0.7 }}>{event.name}</p>
      <p style={{ opacity: 0.7, marginTop: 8 }}>{subtitle}</p>
      <form onSubmit={submit}>
        <input className="pin-input" inputMode="numeric" pattern="[0-9]*" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" autoFocus />
        <input className="input-field" style={{ fontSize: 'var(--text-sm)', textAlign: 'center', marginBottom: 16 }} value={device} onChange={e => setDevice(e.target.value)} placeholder={t.device} />
        {error && <div className="reg-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="branded-btn" type="submit" disabled={busy || pin.length < 4}>{busy ? '…' : t.enter} →</button>
      </form>
    </>
  );
}

// ─── Scanner ─────────────────────────────────────────────────

type Overlay = { kind: 'ok' | 'duplicate' | 'cancelled' | 'invalid' | 'error'; guest?: ScannerGuest; checkInId?: string; admitted?: number; message?: string };

function ScannerScreen({ event, session, lang, onLogout }: { event: PublicEvent; session: ScannerSession; lang: 'es' | 'en'; onLogout: () => void }) {
  const t = SCANNER_TEXT[lang];
  const [mode, setMode] = useState<'camera' | 'search'>('camera');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [stats, setStats] = useState<ScannerStats | null>(null);
  const [recent, setRecent] = useState<RecentCheckIn[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScannerGuest[]>([]);
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastCode = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const overlayTimer = useRef<number | null>(null);

  const refreshStats = useCallback(async () => {
    const r = await scannerStats(session.token);
    if (!isFail(r)) { setStats(r.stats); setRecent(r.recent); }
    else if (r.code === 'session_expired') onLogout();
  }, [session.token, onLogout]);

  useEffect(() => {
    (async () => { await refreshStats(); })();
    const id = window.setInterval(refreshStats, 20_000);
    return () => window.clearInterval(id);
  }, [refreshStats]);

  const showOverlay = useCallback((o: Overlay, ms = 3500) => {
    if (overlayTimer.current) window.clearTimeout(overlayTimer.current);
    setOverlay(o);
    if (navigator.vibrate) navigator.vibrate(o.kind === 'ok' ? 80 : [60, 60, 60]);
    overlayTimer.current = window.setTimeout(() => setOverlay(null), ms);
  }, []);

  const applyResult = useCallback((res: ScanResult) => {
    if (res.result === 'ok') showOverlay({ kind: 'ok', guest: res.guest, checkInId: res.check_in_id, admitted: res.admitted }, 4000);
    else if (res.result === 'invalid') showOverlay({ kind: 'invalid' });
    else showOverlay({ kind: res.result, guest: res.guest });
    refreshStats();
  }, [showOverlay, refreshStats]);

  const handleCode = useCallback(async (code: string) => {
    const now = Date.now();
    if (lastCode.current.code === code && now - lastCode.current.at < 4000) return;
    lastCode.current = { code, at: now };
    const res = await scanCode(session.token, code);
    if (isFail(res)) {
      if (res.code === 'session_expired') onLogout();
      else showOverlay({ kind: 'error', message: res.message });
      return;
    }
    applyResult(res);
  }, [session.token, applyResult, showOverlay, onLogout]);

  // Cámara
  useEffect(() => {
    if (mode !== 'camera') return;
    let stopped = false;
    const el = document.getElementById('we-reader');
    if (!el) return;
    const scanner = new Html5Qrcode('we-reader', { verbose: false });
    scannerRef.current = scanner;
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const s = Math.min(w, h) * 0.7; return { width: s, height: s }; } },
      (text) => { if (!stopped) handleCode(text); },
      () => {},
    ).catch(err => { setCameraError(`${t.camera_error} (${String(err).slice(0, 80)})`); });
    return () => {
      stopped = true;
      scanner.stop().then(() => scanner.clear()).catch(() => {});
      scannerRef.current = null;
    };
  }, [mode, handleCode, t.camera_error]);

  // Búsqueda manual
  useEffect(() => {
    if (mode !== 'search' || query.trim().length < 2) return;
    const id = window.setTimeout(async () => {
      const r = await searchGuests(session.token, query.trim());
      if (!isFail(r)) setResults(r.results);
    }, 250);
    return () => window.clearTimeout(id);
  }, [query, mode, session.token]);

  async function admit(g: ScannerGuest) {
    setBusy(true);
    const res = await manualCheckIn(session.token, g.id);
    setBusy(false);
    if (isFail(res)) return showOverlay({ kind: 'error', message: res.message });
    applyResult(res);
    setQuery(''); setResults([]);
  }

  async function undo(id: string) {
    await undoCheckIn(session.token, id);
    setOverlay(null);
    refreshStats();
  }

  const timeStr = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(lang === 'es' ? 'es-MX' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <div className="scan-screen">
      <div className="scan-header">
        <div>
          <div className="scan-title">{pickLocalized(event.screens?.scanner?.title, lang, t.title)}</div>
          <div className="scan-sub">{event.name}{session.event && ''}</div>
        </div>
        {stats && (
          <div className="scan-stats" onClick={refreshStats} title={t.stats}>
            <b>{stats.entered_people}</b> / {stats.expected_people} {t.people}
            <small>{stats.entered_registrations} / {stats.registrations} {lang === 'es' ? 'registros' : 'registrations'}</small>
          </div>
        )}
      </div>

      <div className="segmented" style={{ alignSelf: 'center', margin: '8px 0' }}>
        <button type="button" className={mode === 'camera' ? 'active' : ''} onClick={() => setMode('camera')}>📷 QR</button>
        <button type="button" className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>🔎 {t.manual}</button>
      </div>

      {mode === 'camera' ? (
        <div className="scan-camera">
          <div id="we-reader" />
          {cameraError ? <div className="reg-error">{cameraError}</div> : <p className="reg-hint" style={{ textAlign: 'center', marginTop: 8 }}>{t.scanning}</p>}
        </div>
      ) : (
        <div className="scan-search">
          <input className="search-input" style={{ width: '100%', maxWidth: 'none', fontSize: '1rem', padding: 12 }} value={query} onChange={e => { setQuery(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} placeholder={t.search} autoFocus />
          <div className="scan-results">
            {query.trim().length >= 2 && results.length === 0 && <p className="reg-hint" style={{ textAlign: 'center', padding: 16 }}>{t.noResults}</p>}
            {results.map(g => {
              const done = g.entered >= g.party_size;
              return (
                <div key={g.id} className={`scan-result ${done ? 'done' : ''} ${g.status === 'cancelled' ? 'cancelled' : ''}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{g.name || '—'}</div>
                    <div className="reg-hint">{[g.company, g.email, g.phone].filter(Boolean).join(' · ')}</div>
                    <div className="reg-hint">{g.party_size} {g.party_size === 1 ? t.person : t.people}{g.entered ? ` · ${t.entered} ${g.entered} ${t.at} ${timeStr(g.last_at)}` : ''}</div>
                  </div>
                  {g.status === 'cancelled' ? <span className="badge badge-rechazada">{t.cancelled}</span>
                    : done ? <span className="badge badge-finalizado">{t.duplicate}</span>
                    : <button className="branded-btn" style={{ padding: '8px 14px' }} disabled={busy} onClick={() => admit(g)}>{t.admit}</button>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="scan-recent">
          {recent.slice(0, 6).map(c => (
            <div key={c.id} className="scan-recent-row"><span>{c.name}</span><span className="reg-hint">{c.count > 1 ? `+${c.count} · ` : ''}{timeStr(c.at)}</span></div>
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
        <button className="btn btn-ghost btn-xs" onClick={onLogout}>{t.logout}</button>
      </div>

      {overlay && (
        <div className={`scan-overlay ${overlay.kind}`} onClick={() => setOverlay(null)}>
          <div className="scan-overlay-icon">{overlay.kind === 'ok' ? '✓' : overlay.kind === 'duplicate' ? '⟲' : '✕'}</div>
          <div className="scan-overlay-title">
            {overlay.kind === 'ok' ? t.ok : overlay.kind === 'duplicate' ? t.duplicate : overlay.kind === 'cancelled' ? t.cancelled : overlay.kind === 'invalid' ? t.invalid : overlay.message}
          </div>
          {overlay.guest && (
            <>
              <div className="scan-overlay-name">{overlay.guest.name || '—'}</div>
              <div className="scan-overlay-meta">
                {overlay.kind === 'ok' && overlay.admitted ? `${overlay.admitted} ${overlay.admitted === 1 ? t.person : t.people}` : `${overlay.guest.party_size} ${overlay.guest.party_size === 1 ? t.person : t.people}`}
                {overlay.guest.company ? ` · ${overlay.guest.company}` : ''}
                {overlay.kind === 'duplicate' && overlay.guest.last_at ? ` · ${t.entered} ${t.at} ${timeStr(overlay.guest.last_at)}` : ''}
              </div>
              {overlay.guest.tags.length > 0 && <div className="scan-overlay-meta">{overlay.guest.tags.join(' · ')}</div>}
              {overlay.guest.notes && <div className="scan-overlay-meta">{t.notes}: {overlay.guest.notes}</div>}
            </>
          )}
          {overlay.kind === 'ok' && overlay.checkInId && (
            <button className="btn btn-secondary btn-xs" style={{ marginTop: 16 }} onClick={e => { e.stopPropagation(); undo(overlay.checkInId!); }}>{t.undo}</button>
          )}
        </div>
      )}
    </div>
  );
}
