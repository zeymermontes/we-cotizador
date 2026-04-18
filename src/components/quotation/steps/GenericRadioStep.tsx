interface Option<T> {
  value: T;
  label: string;
  desc?: string;
  price?: string;
}

interface Props<T> {
  title: string;
  subtitle?: string;
  note?: string;
  options: Option<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
}

export default function GenericRadioStep<T>({
  title,
  subtitle,
  note,
  options,
  selected,
  onSelect,
}: Props<T>) {

  return (
    <div className="step-body">
      <div className="step-header">
        <h2 className="step-title">{title}</h2>
        {subtitle && (
          <p className="step-subtitle" style={{ whiteSpace: 'pre-line' }}>
            {subtitle}
          </p>
        )}
      </div>

      {note && <div className="step-note">{note}</div>}

      {options.map((opt, i) => (
        <div
          key={i}
          className={`option-card ${selected === opt.value ? 'selected' : ''}`}
          onClick={() => onSelect(opt.value)}
        >
          <div className="option-radio" />
          <div className="option-content">
            <div className="option-title">{opt.label}</div>
            {opt.desc && <div className="option-desc">{opt.desc}</div>}
          </div>
          {opt.price && <div className="option-price">{opt.price}</div>}
        </div>
      ))}
    </div>
  );
}
