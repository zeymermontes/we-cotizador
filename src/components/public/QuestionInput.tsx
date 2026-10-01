import { useState, useEffect, useRef } from 'react';
import { PhoneInput } from 'react-international-phone';
import 'react-international-phone/style.css';
import type { Question, AnswerValue, Lang, Answers, EvalContext } from '../../lib/form-types';
import { text, RUNNER_TEXT, letterFor, visibleOptions } from '../../lib/form-types';
import DateField from './DateField';

interface Props {
  q: Question;
  value: AnswerValue | undefined;
  lang: Lang;
  keyboard: boolean;
  /** Respuestas actuales: filtran las opciones con condición */
  answers?: Answers;
  ctx?: EvalContext;
  onChange: (v: AnswerValue) => void;
  /** Respuesta "cerrada" (opción única, sí/no, rating): avanza solo. */
  onCommit: () => void;
  onEnter: () => void;
}

export default function QuestionInput({ q, value, lang, keyboard, answers, ctx, onChange, onCommit, onEnter }: Props) {
  const options = answers ? visibleOptions(q, answers, ctx) : (q.options ?? []);
  const t = RUNNER_TEXT[lang];
  const ph = text(q.placeholder, lang);
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => {
    const el = firstRef.current;
    if (el) setTimeout(() => el.focus(), 60);
  }, [q.id]);

  const enterKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(); }
  };

  switch (q.type) {
    case 'short_text':
      return (
        <input
          ref={firstRef as React.RefObject<HTMLInputElement>}
          className="input-field"
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          onKeyDown={enterKey}
          placeholder={ph || (lang === 'es' ? 'Escribe tu respuesta' : 'Type your answer')}
          maxLength={500}
        />
      );

    case 'long_text':
      return (
        <textarea
          ref={firstRef as React.RefObject<HTMLTextAreaElement>}
          className="input-field"
          rows={4}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onEnter(); } }}
          placeholder={ph || (lang === 'es' ? 'Escribe tu respuesta' : 'Type your answer')}
          maxLength={2000}
        />
      );

    case 'email':
      return (
        <input
          ref={firstRef as React.RefObject<HTMLInputElement>}
          className="input-field"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          onKeyDown={enterKey}
          placeholder={ph || 'nombre@correo.com'}
        />
      );

    case 'phone':
      return (
        <PhoneInput
          defaultCountry="mx"
          value={typeof value === 'string' ? value : ''}
          onChange={phone => onChange(phone)}
          inputProps={{ onKeyDown: enterKey, autoFocus: true, autoComplete: 'tel' }}
          placeholder={ph || undefined}
        />
      );

    case 'number':
      return (
        <input
          ref={firstRef as React.RefObject<HTMLInputElement>}
          className="input-field"
          type="number"
          inputMode="numeric"
          min={q.min ?? undefined}
          max={q.max ?? undefined}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          onKeyDown={enterKey}
          placeholder={ph || '0'}
        />
      );

    case 'date':
      return (
        <DateField
          value={typeof value === 'string' ? value : ''}
          lang={lang}
          placeholder={ph}
          onChange={onChange}
          onEnter={onEnter}
        />
      );

    case 'dropdown':
      return (
        <select
          ref={firstRef as React.RefObject<HTMLSelectElement>}
          className="input-field"
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value || null)}
          onKeyDown={enterKey}
        >
          <option value="">{t.choose}…</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>{text(o.label, lang)}</option>
          ))}
        </select>
      );

    case 'single_choice':
      return <Choices q={q} options={options} value={value} lang={lang} keyboard={keyboard} multiple={false} onChange={onChange} onCommit={onCommit} />;

    case 'multiple_choice':
      return <Choices q={q} options={options} value={value} lang={lang} keyboard={keyboard} multiple onChange={onChange} onCommit={onCommit} />;

    case 'yes_no':
      return (
        <div className="options-list">
          {[{ v: true, label: t.yes, key: 'Y' }, { v: false, label: t.no, key: 'N' }].map((o, i) => (
            <div
              key={String(o.v)}
              className={`option-card animate-slide-up ${value === o.v ? 'selected' : ''}`}
              style={{ animationDelay: `${i * 50}ms` }}
              onClick={() => { onChange(o.v); onCommit(); }}
            >
              {keyboard && <span className="option-key">{o.key}</span>}
              <div className="option-radio" />
              <div className="option-content"><div className="option-title">{o.label}</div></div>
            </div>
          ))}
        </div>
      );

    case 'rating': {
      const steps = q.ratingSteps ?? 5;
      const icon = q.ratingIcon ?? 'star';
      const n = typeof value === 'number' ? value : 0;
      return (
        <div className="rating-row">
          {Array.from({ length: steps }, (_, i) => i + 1).map(i => (
            <button
              key={i}
              type="button"
              className={`rating-btn ${n >= i && icon !== 'number' ? 'active' : n === i ? 'active' : ''}`}
              onClick={() => { onChange(i); onCommit(); }}
              aria-label={String(i)}
            >
              {icon === 'star' ? '★' : icon === 'heart' ? '♥' : i}
            </button>
          ))}
        </div>
      );
    }

    case 'legal':
      return (
        <div className="options-list">
          <div
            className={`option-card ${value === true ? 'selected' : ''}`}
            onClick={() => onChange(value === true ? null : true)}
          >
            {keyboard && <span className="option-key">Y</span>}
            <div className="option-check" />
            <div className="option-content"><div className="option-title">{t.accept}</div></div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

// ─── Opciones (única / múltiple) ─────────────────────────────

interface ChoicesProps {
  q: Question;
  options: Question['options'];
  value: AnswerValue | undefined;
  lang: Lang;
  keyboard: boolean;
  multiple: boolean;
  onChange: (v: AnswerValue) => void;
  onCommit: () => void;
}

function Choices({ q, options: optionsIn, value, lang, keyboard, multiple, onChange, onCommit }: ChoicesProps) {
  const t = RUNNER_TEXT[lang];
  const options = optionsIn ?? [];
  const selected: string[] = multiple
    ? (Array.isArray(value) ? value : [])
    : (typeof value === 'string' ? [value] : []);
  const otherSelected = selected.find(s => s.startsWith('other:'));
  const [otherText, setOtherText] = useState(otherSelected ? otherSelected.slice(6) : '');
  const hasImages = options.some(o => o.image);

  const toggle = (id: string) => {
    if (multiple) {
      const next = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id];
      if (q.maxSelections && next.length > q.maxSelections) return;
      onChange(next);
    } else {
      onChange(id);
      onCommit();
    }
  };

  const setOther = (txt: string) => {
    setOtherText(txt);
    const tag = `other:${txt}`;
    if (multiple) onChange([...selected.filter(s => !s.startsWith('other:')), ...(txt ? [tag] : [])]);
    else onChange(txt ? tag : null);
  };

  return (
    <>
      <p className="reg-hint" style={{ marginBottom: 10 }}>
        {multiple
          ? (q.maxSelections ? t.choose_up_to.replace('{{n}}', String(q.maxSelections)) : t.choose_many)
          : t.choose}
      </p>
      <div className={hasImages ? 'options-grid' : 'options-list'}>
        {options.map((o, i) => (
          <div
            key={o.id}
            className={`option-card animate-slide-up ${selected.includes(o.id) ? 'selected' : ''} ${o.image ? 'has-image' : ''}`}
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            onClick={() => toggle(o.id)}
          >
            {o.image && (
              <div className="option-card-image-wrapper">
                <img src={o.image} alt="" className="option-card-image" loading="lazy" />
              </div>
            )}
            {keyboard && !o.image && <span className="option-key">{letterFor(i)}</span>}
            <div className={multiple ? 'option-check' : 'option-radio'} />
            <div className="option-content"><div className="option-title">{text(o.label, lang)}</div></div>
          </div>
        ))}
        {q.allowOther && (
          <div
            className={`option-card animate-slide-up ${otherSelected ? 'selected' : ''}`}
            onClick={() => { if (!otherSelected) setOther(otherText || ' '); }}
          >
            <div className={multiple ? 'option-check' : 'option-radio'} />
            <div className="option-content">
              <div className="option-title">{t.other}</div>
              {(otherSelected || otherText) && (
                <input
                  className="input-field"
                  style={{ fontSize: 'var(--text-base)', padding: '6px 0' }}
                  value={otherText.trim()}
                  onChange={e => setOther(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  placeholder={t.other_placeholder}
                  autoFocus
                />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
