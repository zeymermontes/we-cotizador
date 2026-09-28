import { useState } from 'react';
import type { EventRow, EventLanguage } from '../../../../lib/events-types';
import { LANGUAGE_LABEL } from '../../../../lib/events-types';
import type { FormSchema } from '../../../../lib/form-types';
import BrandedShell from '../../../public/BrandedShell';
import FormRunner from '../../../public/FormRunner';

interface Props {
  schema: FormSchema;
  event: EventRow;
}

export default function FormPreview({ schema, event }: Props) {
  const [lang, setLang] = useState<EventLanguage>(event.default_language);
  const [run, setRun] = useState(0);
  const effectiveLang = event.languages.includes(lang) ? lang : event.languages[0];

  return (
    <div className="builder-preview">
      <div className="preview-toolbar">
        <span>Vista previa</span>
        <span className="spacer" style={{ flex: 1 }} />
        {event.languages.length > 1 && (
          <div className="segmented">
            {event.languages.map(l => (
              <button key={l} type="button" className={l === effectiveLang ? 'active' : ''} onClick={() => setLang(l)}>{LANGUAGE_LABEL[l]}</button>
            ))}
          </div>
        )}
        <button className="btn btn-ghost btn-xs" onClick={() => setRun(r => r + 1)} title="Volver a empezar">↺</button>
      </div>
      <div className="phone-frame">
        <div className="phone-screen">
          <BrandedShell event={event} variant="form" embedded>
            <FormRunner
              key={`${run}-${effectiveLang}`}
              schema={schema}
              event={event}
              lang={effectiveLang}
              mode="preview"
              onSubmit={async () => ({ ok: true })}
            />
          </BrandedShell>
        </div>
      </div>
      <p className="text-muted text-xs" style={{ textAlign: 'center', marginTop: 10 }}>
        Aquí nada se guarda. Los cambios se ven al instante.
      </p>
    </div>
  );
}
