import { GUEST_COUNT_RANGES, type GuestCountRange } from '../../../lib/quotation-types';

interface Props {
  title: string;
  note?: string;
  selected: GuestCountRange | null;
  onSelect: (value: string) => void;
}

export default function GuestCountStep({ title, note, selected, onSelect }: Props) {
  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{title}</h2>
      </div>

      {note && <div className="step-note">{note}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
        {GUEST_COUNT_RANGES.map(range => (
          <div
            key={range.label}
            className={`option-card ${selected === range.label ? 'selected' : ''}`}
            onClick={() => onSelect(range.label)}
            style={{ justifyContent: 'center', padding: '16px 12px' }}
          >
            <div className="option-radio" />
            <div className="option-content">
              <div className="option-title" style={{ justifyContent: 'center' }}>
                {range.label}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
