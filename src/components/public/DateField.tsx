import { forwardRef, useRef } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { es } from 'date-fns/locale/es';
import { enUS } from 'date-fns/locale/en-US';
import type { Lang } from '../../lib/form-types';

registerLocale('es', es);
registerLocale('en', enUS);

const PORTAL_ID = 'we-date-portal';
const BRAND_VARS = ['--brand-primary', '--brand-bg', '--brand-surface', '--brand-text', '--brand-button-text', '--brand-font-display', '--brand-font-body', '--brand-radius'];

const pad = (n: number) => String(n).padStart(2, '0');
/** Fecha local → "YYYY-MM-DD" (lo que valida el motor), sin pasar por UTC. */
const toStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromStr = (s: string | undefined): Date | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

interface Props {
  value: string | undefined;
  lang: Lang;
  placeholder?: string;
  onChange: (v: string) => void;
  /** Enter con el calendario cerrado: avanza. */
  onEnter: () => void;
}

/** Disparador sin teclado: muestra la fecha elegida o el placeholder. */
const Trigger = forwardRef<HTMLButtonElement, { value?: string; onClick?: () => void; placeholder?: string }>(
  ({ value, onClick, placeholder }, ref) => (
    <button type="button" ref={ref} className={`input-field we-date-trigger ${value ? '' : 'empty'}`} onClick={onClick}>
      <span>{value || placeholder}</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    </button>
  ),
);
Trigger.displayName = 'DateTrigger';

/**
 * Fecha con calendario emergente (centrado, también en celular), con menús de mes y año
 * para fechas lejanas como cumpleaños. Hereda los colores y fuentes del branding.
 */
export default function DateField({ value, lang, placeholder, onChange, onEnter }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);

  // El calendario vive fuera de .branded-page (portal en body): se le copian las variables del branding.
  const onOpen = () => {
    openRef.current = true;
    const page = wrapRef.current?.closest('.branded-page') as HTMLElement | null;
    const portal = document.getElementById(PORTAL_ID);
    if (!page || !portal) return;
    const cs = getComputedStyle(page);
    for (const v of BRAND_VARS) portal.style.setProperty(v, cs.getPropertyValue(v));
  };

  const year = new Date().getFullYear();

  return (
    <div ref={wrapRef} className="we-date" onKeyDown={e => { if (e.key === 'Enter' && !openRef.current) { e.preventDefault(); onEnter(); } }}>
      <DatePicker
        selected={fromStr(value)}
        onChange={(d: Date | null) => onChange(d ? toStr(d) : '')}
        locale={lang}
        dateFormat="d 'de' MMMM 'de' yyyy"
        placeholderText={placeholder || (lang === 'es' ? 'Elige una fecha' : 'Pick a date')}
        customInput={<Trigger />}
        withPortal
        portalId={PORTAL_ID}
        calendarClassName="we-datepicker"
        showPopperArrow={false}
        showMonthDropdown
        showYearDropdown
        dropdownMode="select"
        minDate={new Date(1900, 0, 1)}
        maxDate={new Date(year + 20, 11, 31)}
        onCalendarOpen={onOpen}
        onCalendarClose={() => { openRef.current = false; }}
        isClearable
        shouldCloseOnSelect
        formatWeekDay={d => d.slice(0, 2)}
      />
    </div>
  );
}
