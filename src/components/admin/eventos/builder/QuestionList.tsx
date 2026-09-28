import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Question, Lang } from '../../../../lib/form-types';
import { TYPE_INFO, text } from '../../../../lib/form-types';

interface Props {
  questions: Question[];
  selectedId: string | null;
  lang: Lang;
  onSelect: (id: string) => void;
  onReorder: (next: Question[]) => void;
  onAdd: () => void;
}

export default function QuestionList({ questions, selectedId, lang, onSelect, onReorder, onAdd }: Props) {
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
            <Item key={q.id} q={q} index={i} lang={lang} active={q.id === selectedId} onSelect={() => onSelect(q.id)} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Item({ q, index, lang, active, onSelect }: { q: Question; index: number; lang: Lang; active: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const title = text(q.title, lang) || (q.type === 'hidden' ? `oculto: ${q.key ?? ''}` : '');
  const info = TYPE_INFO[q.type];
  const hasLogic = (q.logic?.length ?? 0) > 0 || (q.showIf?.conditions.length ?? 0) > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`builder-item ${active ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onSelect}
    >
      <span className="drag-handle" {...attributes} {...listeners} title="Arrastra para reordenar">⋮⋮</span>
      <span className="item-num">{index + 1}</span>
      <span className="item-icon" title={info.label}>{info.icon}</span>
      <span className={`item-title ${title ? '' : 'empty'}`}>{title || 'Sin título'}</span>
      <span className="item-flags">
        {q.required && q.type !== 'statement' && q.type !== 'hidden' && <span title="Obligatoria">*</span>}
        {hasLogic && <span title="Tiene lógica">⤳</span>}
        {q.identity && <span title={`Identidad: ${q.identity}`}>id</span>}
      </span>
    </div>
  );
}
