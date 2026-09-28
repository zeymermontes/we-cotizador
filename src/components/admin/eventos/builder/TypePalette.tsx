import type { QuestionType } from '../../../../lib/form-types';
import { QUESTION_TYPES } from '../../../../lib/form-types';

interface Props {
  onPick: (type: QuestionType) => void;
  onCancel?: () => void;
  compact?: boolean;
}

const GROUPS: { key: 'texto' | 'opciones' | 'otros'; label: string }[] = [
  { key: 'texto', label: 'TEXTO Y DATOS' },
  { key: 'opciones', label: 'OPCIONES' },
  { key: 'otros', label: 'OTROS' },
];

export default function TypePalette({ onPick, onCancel, compact }: Props) {
  return (
    <div>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>Agregar pregunta</h3>
          {onCancel && <button className="btn btn-ghost btn-xs" onClick={onCancel}>Cancelar</button>}
        </div>
      )}
      {GROUPS.map(g => (
        <div key={g.key}>
          <div className="palette-group">{g.label}</div>
          <div className="type-palette">
            {QUESTION_TYPES.filter(t => t.group === g.key).map(t => (
              <button key={t.type} type="button" className="type-card" onClick={() => onPick(t.type)}>
                <span className="item-icon">{t.icon}</span>
                <span><b>{t.label}</b><small>{t.hint}</small></span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
