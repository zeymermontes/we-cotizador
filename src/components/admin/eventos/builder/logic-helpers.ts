import type { Question, Lang, Condition, ConditionOp, ConditionValue } from '../../../../lib/form-types';
import { opsFor, text, TYPE_INFO, SPECIAL_VARS } from '../../../../lib/form-types';

export const questionLabel = (q: Question, i: number, lang: Lang) => `${i + 1}. ${text(q.title, lang) || TYPE_INFO[q.type].label}`;

/** Algo que puede condicionar: una pregunta anterior o una variable especial. */
export interface Candidate {
  id: string;
  label: string;
  kind: Question['type'] | 'choice' | 'number' | 'date';
  options?: { id: string; label: string }[];
  /** "esta pregunta" en reglas de salto */
  self?: boolean;
}

export function candidatesFor(questions: Question[], index: number, lang: Lang, includeSelf = false): Candidate[] {
  const list: Candidate[] = [];
  if (includeSelf && questions[index]) {
    const q = questions[index];
    list.push({ id: q.id, label: 'esta pregunta', kind: q.type, options: q.options?.map(o => ({ id: o.id, label: text(o.label, lang) })), self: true });
  }
  questions.forEach((q, i) => {
    if (q.id === questions[index]?.id || q.type === 'statement') return;
    if (i < index || q.type === 'hidden') {
      list.push({ id: q.id, label: questionLabel(q, i, lang), kind: q.type, options: q.options?.map(o => ({ id: o.id, label: text(o.label, lang) })) });
    }
  });
  for (const sv of SPECIAL_VARS) {
    list.push({ id: sv.id, label: `⚙ ${text(sv.label, lang)}`, kind: sv.kind, options: sv.options?.map(o => ({ id: o.id, label: text(o.label, lang) })) });
  }
  return list;
}

export function defaultValueFor(c: Candidate | undefined, op: ConditionOp): ConditionValue | undefined {
  if (!c) return '';
  if (op === 'between') return [0, 10];
  if (op === 'before' || op === 'after') return c.id === '$today' ? '' : '$today';
  if (op.startsWith('count_') || op.startsWith('age_')) return 1;
  if (c.kind === 'yes_no' || c.kind === 'legal') return true;
  if (c.options?.length) return c.options[0].id;
  if (c.kind === 'number' || c.kind === 'rating') return 1;
  return '';
}

export function newConditionFor(c: Candidate | undefined): Condition | null {
  if (!c) return null;
  const op = opsFor(c.kind)[0] ?? 'eq';
  return { questionId: c.id, op, value: defaultValueFor(c, op) };
}

