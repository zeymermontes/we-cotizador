import { useRef } from 'react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Question, Lang } from '../../../../lib/form-types';
import { TYPE_INFO, text } from '../../../../lib/form-types';

interface Props {
  questions: Question[];
  selectedId: string | null;
  lang: Lang;
  /** Problemas del linter por pregunta */
  issues?: Map<string, 'error' | 'warning'>;
  onSelect: (id: string) => void;
  onReorder: (next: Question[]) => void;
  onAdd: () => void;
}

export default function QuestionList({ questions, selectedId, lang, issues, onSelect, onReorder, onAdd }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = questions.findIndex(q => q.id === active.id);
    const to = questions.findIndex(q => q.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(questions, from, to));
  }

  return (
    <div className="builder-list">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 10px' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          PREGUNTAS · {questions.length}
        </span>
        <button className="btn btn-primary btn-xs" onClick={onAdd}>+ Agregar</button>
      </div>

      {questions.length === 0 && (
        <p className="text-muted text-sm" style={{ padding: 8 }}>Sin preguntas todavía.</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
          {questions.map((q, i) => (
            <Item key={q.id} q={q} index={i} lang={lang} active={q.id === selectedId} issue={issues?.get(q.id) ?? null} onSelect={() => onSelect(q.id)} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Item({ q, index, lang, active, issue, onSelect }: { q: Question; index: number; lang: Lang; active: boolean; issue: 'error' | 'warning' | null; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const title = text(q.title, lang) || (q.type === 'hidden' ? `oculto: ${q.key ?? ''}` : '');
  const info = TYPE_INFO[q.type];
  const hasLogic = (q.logic?.length ?? 0) > 0 || (q.showIf?.conditions.length ?? 0) > 0;
  const titleRef = useRef<HTMLSpanElement>(null);

  // Si el título no cabe, al pasar el mouse se desliza a la izquierda para leerlo completo
  const slideIn = () => {
    const el = titleRef.current; if (!el) return;
    const inner = el.firstElementChild as HTMLElement | null; if (!inner) return;
    const overflow = inner.scrollWidth - el.clientWidth;
    if (overflow <= 0) return;
    inner.style.transition = `transform ${Math.max(0.8, overflow / 40)}s linear 0.3s`;
    inner.style.transform = `translateX(-${overflow + 4}px)`;
  };
  const slideOut = () => {
    const inner = titleRef.current?.firstElementChild as HTMLElement | null; if (!inner) return;
    inner.style.transition = 'transform 0.25s ease';
    inner.style.transform = 'translateX(0)';
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`builder-item ${active ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onSelect}
      onMouseEnter={slideIn}
      onMouseLeave={slideOut}
    >
      <span className="drag-handle" {...attributes} {...listeners} title="Arrastra para reordenar">⋮⋮</span>
      <span className="item-num">{index + 1}</span>
      <span className="item-icon" title={info.label}>{info.icon}</span>
      <span ref={titleRef} className={`item-title ${title ? '' : 'empty'}`}><span className="item-title-inner">{title || 'Sin título'}</span></span>
      <span className="item-flags">
        {issue && <span className={`flag-${issue}`} title={issue === 'error' ? 'Tiene errores' : 'Tiene avisos'}>{issue === 'error' ? '⛔' : '⚠️'}</span>}
        {q.required && q.type !== 'statement' && q.type !== 'hidden' && <span title="Obligatoria">*</span>}
        {hasLogic && <span title="Tiene lógica">⤳</span>}
        {q.identity && <span title={`Identidad: ${q.identity}`}>id</span>}
      </span>
    </div>
  );
}
