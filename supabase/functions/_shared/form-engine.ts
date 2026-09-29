// ─────────────────────────────────────────────────────────────
// Motor del formulario de registro.
//
// TypeScript puro, sin dependencias: lo importan el navegador (builder
// y formulario público) y la edge function submit-registration, así
// la lógica condicional y la validación son EXACTAMENTE las mismas en
// los dos lados. No usar APIs de Deno ni del DOM aquí.
// ─────────────────────────────────────────────────────────────

export type Lang = 'es' | 'en';
export type Localized = Partial<Record<Lang, string>>;

export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'single_choice'
  | 'multiple_choice'
  | 'dropdown'
  | 'yes_no'
  | 'date'
  | 'rating'
  | 'legal'
  | 'statement'
  | 'hidden';

/** Preguntas que se promueven a columnas de `registrations`. */
export type Identity = 'name' | 'email' | 'phone' | 'party_size' | 'company';

export interface ChoiceOption {
  id: string;
  label: Localized;
  image?: string | null;
}

export type ConditionOp =
  | 'eq' | 'neq'
  | 'contains' | 'not_contains'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'empty' | 'not_empty';

export interface Condition {
  questionId: string;
  op: ConditionOp;
  /** Para opciones es el id de la opción; para sí/no, true/false. */
  value?: string | number | boolean;
}

export interface ConditionGroup {
  match: 'all' | 'any';
  conditions: Condition[];
}

export interface LogicRule extends ConditionGroup {
  id: string;
  /** id de pregunta o 'end' para terminar el formulario. */
  jumpTo: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  title: Localized;
  description?: Localized;
  required: boolean;
  image?: string | null;

  /** single_choice, multiple_choice, dropdown */
  options?: ChoiceOption[];
  allowOther?: boolean;
  maxSelections?: number | null;

  /** textos, número */
  placeholder?: Localized;
  min?: number | null;
  max?: number | null;

  /** rating */
  ratingSteps?: number;
  ratingIcon?: 'star' | 'heart' | 'number';

  /** statement */
  buttonLabel?: Localized;

  /** hidden: nombre del parámetro en la URL */
  key?: string;

  identity?: Identity | null;
  showIf?: ConditionGroup | null;
  logic?: LogicRule[];
}

export interface FormSettings {
  showProgress: boolean;
  showStepCounter: boolean;
  keyboardShortcuts: boolean;
  /** Qué hacer si ya existe un registro con el mismo correo/teléfono. */
  duplicates: 'allow' | 'block_email' | 'block_phone' | 'block_both';
  submitLabel?: Localized;
}

export interface FormSchema {
  v: 1;
  questions: Question[];
  settings: FormSettings;
}

export type AnswerValue = string | number | boolean | string[] | null;
export type Answers = Record<string, AnswerValue>;

export const DEFAULT_SETTINGS: FormSettings = {
  showProgress: true,
  showStepCounter: true,
  keyboardShortcuts: true,
  duplicates: 'block_email',
};

export function normalizeSchema(raw: unknown): FormSchema {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<FormSchema>;
  return {
    v: 1,
    questions: Array.isArray(s.questions) ? s.questions : [],
    settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) },
  };
}

// ─── Helpers ─────────────────────────────────────────────────

export const CHOICE_TYPES: QuestionType[] = ['single_choice', 'multiple_choice', 'dropdown'];
export const isChoice = (t: QuestionType) => CHOICE_TYPES.includes(t);
/** Tipos que no son un paso visible del formulario. */
export const isStep = (q: Question) => q.type !== 'hidden';
/** Tipos que no piden respuesta. */
export const isInformational = (t: QuestionType) => t === 'statement';

export function text(value: Localized | undefined, lang: Lang, fallback = ''): string {
  if (!value) return fallback;
  return value[lang] || value.es || value.en || fallback;
}

export function isEmpty(v: AnswerValue | undefined): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// ─── Condiciones ─────────────────────────────────────────────

export function evalCondition(c: Condition, answers: Answers): boolean {
  const v = answers[c.questionId];
  switch (c.op) {
    case 'empty': return isEmpty(v);
    case 'not_empty': return !isEmpty(v);
    case 'eq':
      if (Array.isArray(v)) return v.includes(String(c.value));
      if (typeof v === 'boolean' || typeof c.value === 'boolean') return String(v) === String(c.value);
      return !isEmpty(v) && String(v).trim().toLowerCase() === String(c.value ?? '').trim().toLowerCase();
    case 'neq':
      return !evalCondition({ ...c, op: 'eq' }, answers);
    case 'contains':
      if (Array.isArray(v)) return v.includes(String(c.value));
      return !isEmpty(v) && String(v).toLowerCase().includes(String(c.value ?? '').toLowerCase());
    case 'not_contains':
      return !evalCondition({ ...c, op: 'contains' }, answers);
    case 'gt': case 'lt': case 'gte': case 'lte': {
      const a = num(v); const b = num(c.value);
      if (a === null || b === null) return false;
      if (c.op === 'gt') return a > b;
      if (c.op === 'lt') return a < b;
      if (c.op === 'gte') return a >= b;
      return a <= b;
    }
    default: return false;
  }
}

export function evalGroup(g: ConditionGroup | null | undefined, answers: Answers): boolean {
  if (!g || g.conditions.length === 0) return true;
  const results = g.conditions.map(c => evalCondition(c, answers));
  return g.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

// ─── Flujo ───────────────────────────────────────────────────

/**
 * Lista ordenada de ids de pregunta que el invitado ve, dadas las
 * respuestas actuales. Es el equivalente al `stepKeys` del cotizador,
 * pero leyendo reglas guardadas en vez de código.
 *
 * - Una pregunta con `showIf` falso se salta.
 * - Después de una pregunta, la primera regla de salto que se cumple
 *   manda a otra pregunta o a 'end'.
 * - Los saltos hacia atrás se cortan para no ciclar.
 */
export function resolveFlow(schema: FormSchema, answers: Answers): string[] {
  const qs = schema.questions.filter(isStep);
  const path: string[] = [];
  const visited = new Set<string>();
  let i = 0;

  while (i < qs.length) {
    const q = qs[i];
    if (visited.has(q.id)) break;
    visited.add(q.id);

    if (!evalGroup(q.showIf, answers)) { i++; continue; }
    path.push(q.id);

    const rule = (q.logic ?? []).find(r => r.conditions.length > 0 && evalGroup(r, answers));
    if (rule) {
      if (rule.jumpTo === 'end') break;
      const idx = qs.findIndex(x => x.id === rule.jumpTo);
      if (idx > i) { i = idx; continue; }
      // destino inexistente o hacia atrás: seguimos en orden
    }
    i++;
  }
  return path;
}

// ─── Validación de respuestas ────────────────────────────────

export type AnswerError =
  | 'required' | 'email' | 'phone' | 'number' | 'min' | 'max'
  | 'max_selections' | 'option' | 'date' | 'legal' | 'too_long';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_TEXT = 2000;

export function validateAnswer(q: Question, v: AnswerValue | undefined): AnswerError | null {
  if (q.type === 'statement' || q.type === 'hidden') return null;

  if (isEmpty(v)) return q.required ? 'required' : null;

  switch (q.type) {
    case 'short_text':
    case 'long_text':
      return String(v).length > MAX_TEXT ? 'too_long' : null;
    case 'email':
      return EMAIL_RE.test(String(v).trim()) ? null : 'email';
    case 'phone': {
      const digits = String(v).replace(/\D/g, '');
      return digits.length >= 8 && digits.length <= 15 ? null : 'phone';
    }
    case 'number': {
      const n = num(v);
      if (n === null) return 'number';
      if (q.min != null && n < q.min) return 'min';
      if (q.max != null && n > q.max) return 'max';
      return null;
    }
    case 'single_choice':
    case 'dropdown': {
      const ids = (q.options ?? []).map(o => o.id);
      const s = String(v);
      if (ids.includes(s)) return null;
      return q.allowOther && s.startsWith('other:') ? null : 'option';
    }
    case 'multiple_choice': {
      const arr = Array.isArray(v) ? v : [String(v)];
      const ids = (q.options ?? []).map(o => o.id);
      for (const s of arr) {
        if (!ids.includes(s) && !(q.allowOther && s.startsWith('other:'))) return 'option';
      }
      if (q.maxSelections && arr.length > q.maxSelections) return 'max_selections';
      return null;
    }
    case 'yes_no':
      return typeof v === 'boolean' ? null : 'option';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(String(v))) ? null : 'date';
    case 'rating': {
      const n = num(v);
      const steps = q.ratingSteps ?? 5;
      return n !== null && n >= 1 && n <= steps ? null : 'option';
    }
    case 'legal':
      return v === true ? null : 'legal';
    default:
      return null;
  }
}

/**
 * Valida todas las respuestas del camino. Devuelve errores por id y
 * las respuestas limpias (solo las del camino + ocultas), para que
 * el servidor no guarde basura de ramas no visitadas.
 */
export function validateSubmission(schema: FormSchema, answers: Answers): {
  errors: Record<string, AnswerError>;
  clean: Answers;
  path: string[];
} {
  const path = resolveFlow(schema, answers);
  const errors: Record<string, AnswerError> = {};
  const clean: Answers = {};
  const byId = new Map(schema.questions.map(q => [q.id, q]));

  for (const id of path) {
    const q = byId.get(id)!;
    const err = validateAnswer(q, answers[id]);
    if (err) errors[id] = err;
    if (!isEmpty(answers[id])) clean[id] = answers[id] as AnswerValue;
  }
  for (const q of schema.questions) {
    if (q.type === 'hidden' && !isEmpty(answers[q.id])) clean[q.id] = String(answers[q.id]).slice(0, 200);
  }
  return { errors, clean, path };
}

/** Saca las columnas promovidas (nombre, correo, ...) de las respuestas. */
export function extractIdentity(schema: FormSchema, answers: Answers): {
  name: string | null; email: string | null; phone: string | null; party_size: number; company: string | null;
} {
  const out = { name: null as string | null, email: null as string | null, phone: null as string | null, party_size: 1, company: null as string | null };
  for (const q of schema.questions) {
    if (!q.identity) continue;
    const v = answers[q.id];
    if (isEmpty(v)) continue;
    switch (q.identity) {
      case 'name': out.name = String(v).trim().slice(0, 200); break;
      case 'email': out.email = String(v).trim().toLowerCase(); break;
      case 'phone': out.phone = String(v).replace(/[^\d+]/g, ''); break;
      case 'company': out.company = String(v).trim().slice(0, 200); break;
      case 'party_size': {
        // Puede venir de un número o de una opción cuya etiqueta sea un número
        let n = num(v);
        if (n === null && isChoice(q.type)) {
          const opt = (q.options ?? []).find(o => o.id === String(v));
          n = num(opt?.label?.es ?? opt?.label?.en ?? '');
        }
        if (n !== null && n >= 1) out.party_size = Math.min(50, Math.round(n));
        break;
      }
    }
  }
  return out;
}

// ─── Validación del esquema (al publicar) ─────────────────────

export interface SchemaIssue {
  questionId?: string;
  level: 'error' | 'warning';
  message: string;
}

export function validateSchema(schema: FormSchema, langs: Lang[]): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const qs = schema.questions;
  const ids = new Set(qs.map(q => q.id));

  if (qs.filter(isStep).length === 0) {
    issues.push({ level: 'error', message: 'El formulario no tiene preguntas.' });
    return issues;
  }

  const seenIdentity = new Set<Identity>();
  qs.forEach((q, index) => {
    const n = index + 1;
    for (const lang of langs) {
      if (q.type !== 'hidden' && !text(q.title, lang).trim()) {
        issues.push({ questionId: q.id, level: 'error', message: `Pregunta ${n}: falta el título en ${lang.toUpperCase()}.` });
      }
    }
    if (isChoice(q.type)) {
      const opts = q.options ?? [];
      if (opts.length === 0) issues.push({ questionId: q.id, level: 'error', message: `Pregunta ${n}: agrega al menos una opción.` });
      opts.forEach((o, oi) => {
        for (const lang of langs) {
          if (!text(o.label, lang).trim()) {
            issues.push({ questionId: q.id, level: 'error', message: `Pregunta ${n}, opción ${oi + 1}: falta el texto en ${lang.toUpperCase()}.` });
          }
        }
      });
    }
    if (q.type === 'hidden' && !(q.key ?? '').trim()) {
      issues.push({ questionId: q.id, level: 'error', message: `Pregunta ${n}: el campo oculto necesita el nombre del parámetro de URL.` });
    }
    if (q.identity) {
      if (seenIdentity.has(q.identity)) {
        issues.push({ questionId: q.id, level: 'error', message: `Pregunta ${n}: ya hay otra pregunta marcada como "${q.identity}".` });
      }
      seenIdentity.add(q.identity);
    }
    for (const c of q.showIf?.conditions ?? []) {
      if (!ids.has(c.questionId)) issues.push({ questionId: q.id, level: 'error', message: `Pregunta ${n}: una condición de "mostrar si" apunta a una pregunta que ya no existe.` });
    }
    for (const r of q.logic ?? []) {
      if (r.jumpTo !== 'end' && !ids.has(r.jumpTo)) {
        issues.push({ questionId: q.id, level: 'error', message: `Pregunta ${n}: un salto apunta a una pregunta que ya no existe.` });
      }
      for (const c of r.conditions) {
        if (!ids.has(c.questionId)) issues.push({ questionId: q.id, level: 'error', message: `Pregunta ${n}: una regla de salto usa una pregunta que ya no existe.` });
      }
    }
  });

  if (!seenIdentity.has('name')) {
    issues.push({ level: 'warning', message: 'Ninguna pregunta está marcada como "nombre": los registros se verán sin nombre en la lista.' });
  }
  if (!seenIdentity.has('email') && !seenIdentity.has('phone')) {
    issues.push({ level: 'warning', message: 'Sin correo ni teléfono no podrás enviar confirmaciones ni invitaciones.' });
  }
  return issues;
}

// ─── Respuesta legible ────────────────────────────────────────

/** Texto plano de una respuesta (para tablas, CSV y variables de mensajes). */
export function answerToText(q: Question, v: AnswerValue | undefined, lang: Lang): string {
  if (isEmpty(v)) return '';
  const optLabel = (id: string) => {
    if (id.startsWith('other:')) return `${lang === 'es' ? 'Otro' : 'Other'}: ${id.slice(6)}`;
    const o = (q.options ?? []).find(x => x.id === id);
    return o ? text(o.label, lang) : id;
  };
  switch (q.type) {
    case 'single_choice': case 'dropdown': return optLabel(String(v));
    case 'multiple_choice': return (Array.isArray(v) ? v : [String(v)]).map(optLabel).join(', ');
    case 'yes_no': return v === true ? (lang === 'es' ? 'Sí' : 'Yes') : 'No';
    case 'legal': return v === true ? '✓' : '';
    case 'date': {
      const d = new Date(String(v) + 'T00:00:00');
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    case 'rating': return `${v} / ${q.ratingSteps ?? 5}`;
    default: return Array.isArray(v) ? v.join(', ') : String(v);
  }
}
