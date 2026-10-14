import { useEffect, useMemo, useRef, useState } from 'react';
import { usePhoneInput, defaultCountries, parseCountry, FlagImage } from 'react-international-phone';
import 'react-international-phone/style.css';
import type { Lang } from '../../lib/form-types';

// Teléfono con lada: el mismo motor de react-international-phone (máscara,
// detección de país al pegar) pero con un selector propio que tiene barra de
// búsqueda por nombre (en el idioma del formulario) o por lada.

interface Props {
  value: string;
  lang: Lang;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (phone: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const PREFERRED = ['mx', 'us', 'co', 'es', 'ar', 'cl', 'pe', 'gt', 'ca'];
const TEXT = {
  es: { search: 'Busca país o lada…', none: 'Sin resultados', aria: 'Elegir país' },
  en: { search: 'Search country or code…', none: 'No results', aria: 'Choose country' },
};
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function PhoneField({ value, lang, placeholder, autoFocus, onChange, onKeyDown }: Props) {
  const t = TEXT[lang] ?? TEXT.es;
  const { inputValue, country, setCountry, handlePhoneValueChange, inputRef } = usePhoneInput({
    defaultCountry: 'mx',
    value,
    onChange: d => onChange(d.phone),
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Nombres en el idioma del formulario; si el navegador no los tiene, los de la librería (inglés)
  const names = useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try { dn = new Intl.DisplayNames([lang === 'es' ? 'es' : 'en'], { type: 'region' }); } catch { dn = null; }
    return defaultCountries.map(parseCountry).map(c => {
      let name = c.name;
      try { name = dn?.of(c.iso2.toUpperCase()) ?? c.name; } catch { /* código sin nombre local */ }
      return { iso2: c.iso2, dialCode: c.dialCode, name, key: norm(`${name} ${c.name} +${c.dialCode} ${c.dialCode}`) };
    });
  }, [lang]);

  const list = useMemo(() => {
    const q = norm(query.trim());
    const matches = q ? names.filter(c => c.key.includes(q)) : names;
    if (q) return matches;
    const pref = PREFERRED.map(iso => matches.find(c => c.iso2 === iso)).filter((c): c is NonNullable<typeof c> => !!c);
    const rest = matches.filter(c => !PREFERRED.includes(c.iso2)).sort((a, b) => a.name.localeCompare(b.name, lang));
    return [...pref, ...rest];
  }, [names, query, lang]);

  const toggle = () => { setQuery(''); setOpen(o => !o); };

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDoc); };
  }, [open]);

  const pick = (iso2: string) => { setCountry(iso2, { focusOnInput: true }); setOpen(false); };

  return (
    <div className="phone-field" ref={wrapRef}>
      <button type="button" className="phone-country-btn" aria-label={t.aria} aria-expanded={open} onClick={toggle}>
        <FlagImage iso2={country.iso2} size={24} />
        <span className="phone-caret">▾</span>
      </button>
      <input
        ref={inputRef}
        className="input-field"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus={autoFocus}
        value={inputValue}
        onChange={handlePhoneValueChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      {open && (
        <div className="phone-dropdown" role="listbox">
          <input
            ref={searchRef}
            className="phone-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); setOpen(false); inputRef.current?.focus(); }
              if (e.key === 'Enter') { e.preventDefault(); if (list[0]) pick(list[0].iso2); }
            }}
            placeholder={t.search}
            autoComplete="off"
          />
          <div className="phone-options">
            {list.length === 0 && <div className="phone-empty">{t.none}</div>}
            {list.map(c => (
              <button type="button" key={c.iso2} role="option" aria-selected={c.iso2 === country.iso2} className={`phone-option ${c.iso2 === country.iso2 ? 'selected' : ''}`} onClick={() => pick(c.iso2)}>
                <FlagImage iso2={c.iso2} size={20} />
                <span className="phone-option-name">{c.name}</span>
                <span className="phone-option-code">+{c.dialCode}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
