import BlurredImage from '../../common/BlurredImage';

interface Option<T> {
  value: T;
  label: string;
  desc?: string;
  price?: string;
  image?: string;
}

interface Props<T> {
  title: string;
  subtitle?: string;
  questionImage?: string;
  note?: string;
  options: Option<T>[];
  selected: T[];
  onToggle: (value: T) => void;
}

export default function GenericCheckStep<T>({
  title,
  subtitle,
  questionImage,
  note,
  options,
  selected,
  onToggle,
}: Props<T>) {
  const hasOptionImages = options.some(opt => opt.image);
  return (
    <div className="step-body">
      <div className={`step-header ${questionImage ? 'has-image' : ''}`}>
        <h2 className="step-title">{title}</h2>
        {subtitle && <p className="step-subtitle">{subtitle}</p>}
        {questionImage && (
          <div className="question-example-image-wrapper animate-fade-in">
            <BlurredImage 
              src={questionImage} 
              alt="Example" 
              className="question-example-image" 
            />
          </div>
        )}
      </div>

      {note && <div className="step-note">{note}</div>}

      <div className={hasOptionImages ? 'options-grid' : 'options-list'}>
        {options.map((opt, j) => (
          <div
            key={j}
            className={`option-card ${selected.includes(opt.value) ? 'selected' : ''} ${opt.image ? 'has-image' : ''} animate-slide-up`}
            style={{ animationDelay: `${j * 50}ms` }}
            onClick={() => onToggle(opt.value)}
          >
            {opt.image && (
              <div className="option-card-image-wrapper">
                <BlurredImage 
                  src={opt.image} 
                  alt={opt.label} 
                  className="option-card-image" 
                />
              </div>
            )}
            <div className="option-check" />
            <div className="option-content">
              <div className="option-title">{opt.label}</div>
              {opt.desc && <div className="option-desc">{opt.desc}</div>}
              {opt.price && <div className="option-price">{opt.price}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
