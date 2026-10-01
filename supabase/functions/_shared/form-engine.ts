// ─────────────────────────────────────────────────────────────
// Motor del formulario de registro.
//
// TypeScript puro, sin dependencias: lo importan el navegador (builder
// y formulario público), la edge function submit-registration y el MCP,
// así la lógica condicional, la validación y el linter son EXACTAMENTE
// los mismos en todos lados. No usar APIs de Deno ni del DOM aquí.
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
  /** Puntos que suma al puntaje ($score) si se elige */
  score?: number;
  /** La opción solo se ofrece si se cumple */
  showIf?: ConditionGroup | null;
}

export type ConditionOp =
  | 'eq' | 'neq'
  | 'contains' | 'not_contains'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'between'
  | 'empty' | 'not_empty'
  | 'count_eq' | 'count_gte' | 'count_lte'
  | 'before' | 'after'
  | 'age_gte' | 'age_lte';

export type ConditionValue = string | number | boolean | [number, number];

export interface Condition {
  /** id de pregunta, o una variable especial: $lang, $score, $today */
  questionId: string;
  op: ConditionOp;
  /** Para opciones es el id de la opción; para sí/no, true/false; between: [min, max]. */
  value?: ConditionValue;
}

export interface ConditionGroup {
  match: 'all' | 'any';
  /** Condiciones o subgrupos anidados: (A y B) o C */
  conditions: ConditionNode[];
}
export type ConditionNode = Condition | ConditionGroup;
export const isGroup = (n: ConditionNode): n is ConditionGroup => (n as ConditionGroup).conditions !== undefined;

export interface LogicRule extends ConditionGroup {
  id: string;
  /** id de pregunta, 'end' (final por defecto) o 'end:<endingId>'. */
  jumpTo: string;
}

/** Variables que se pueden usar en condiciones además de las preguntas. */
export const SPECIAL_VARS: { id: string; label: Localized; kind: 'choice' | 'number' | 'date'; options?: { id: string; label: Localized }[] }[] = [
  { id: '$lang', label: { es: 'Idioma del invitado', en: 'Guest language' }, kind: 'choice', options: [{ id: 'es', label: { es: 'Español', en: 'Spanish' } }, { id: 'en', label: { es: 'Inglés', en: 'English' } }] },
  { id: '$score', label: { es: 'Puntaje acumulado', en: 'Score' }, kind: 'number' },
  { id: '$today', label: { es: 'Fecha de hoy', en: 'Today' }, kind: 'date' },
];
export const isSpecialVar = (id: string) => id.startsWith('$');

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

  /** Parámetro de la URL que prellena esta pregunta (en hidden es obligatorio) */
  key?: string;
  /** Si llegó prellenada por URL, no se muestra */
  skipIfPrefilled?: boolean;

  /** yes_no: puntos si responde Sí */
  score?: number;

  /** Bloque o sección (solo organiza la vista de flujo) */
  section?: string;

  identity?: Identity | null;
  showIf?: ConditionGroup | null;
  logic?: LogicRule[];
}

export interface Ending {
  id: string;
  name?: string;
  title: Localized;
  subtitle?: Localized;
}

export interface FormSettings {
  showProgress: boolean;
  showStepCounter: boolean;
  keyboardShortcuts: boolean;
  /** Qué hacer si ya existe un registro con el mismo correo/teléfono. */
  duplicates: 'allow' | 'block_email' | 'block_phone' | 'block_both';
  submitLabel?: Localized;
  /** Finales alternativos; los saltos apuntan con 'end:<id>'. */
  endings?: Ending[];
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

const dateMs = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v.length === 10 ? v + 'T00:00:00' : v);
  return Number.isNaN(t) ? null : t;
};

const ageYears = (birth: unknown, today: string): number | null => {
  const b = dateMs(birth); const t = dateMs(today);
  if (b === null || t === null) return null;
  const bd = new Date(b); const td = new Date(t);
  let age = td.getFullYear() - bd.getFullYear();
  const m = td.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && td.getDate() < bd.getDate())) age--;
  return age;
};

/** Qué operadores tienen sentido para cada tipo (lo usan el editor y el linter). */
export function opsForType(type: QuestionType | 'choice' | 'number' | 'date'): ConditionOp[] {
  switch (type) {
    case 'single_choice': case 'dropdown': case 'yes_no': case 'legal': case 'choice': return ['eq', 'neq', 'empty', 'not_empty'];
    case 'multiple_choice': return ['contains', 'not_contains', 'count_eq', 'count_gte', 'count_lte', 'empty', 'not_empty'];
    case 'number': case 'rating': return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'empty', 'not_empty'];
    case 'date': return ['eq', 'before', 'after', 'age_gte', 'age_lte', 'empty', 'not_empty'];
    case 'statement': return [];
    default: return ['eq', 'neq', 'contains', 'not_contains', 'empty', 'not_empty'];
  }
}

// ─── Puntaje ─────────────────────────────────────────────────

/** Suma de puntos de las opciones elegidas (y sí/no con puntos). */
export function computeScore(schema: FormSchema, answers: Answers): number {
  let score = 0;
  for (const q of schema.questions) {
    const v = answers[q.id];
    if (isEmpty(v)) continue;
    if (isChoice(q.type)) {
      const ids = Array.isArray(v) ? v : [String(v)];
      for (const id of ids) score += q.options?.find(o => o.id === id)?.score ?? 0;
    } else if (q.type === 'yes_no' && v === true) {
      score += q.score ?? 0;
    }
  }
  return score;
}

export interface EvalContext {
  lang?: Lang;
  score?: number;
  /** YYYY-MM-DD; por defecto la fecha actual */
  today?: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function valueOf(id: string, answers: Answers, ctx?: EvalContext): AnswerValue | undefined {
  if (id === '$lang') return ctx?.lang ?? 'es';
  if (id === '$score') return ctx?.score ?? 0;
  if (id === '$today') return ctx?.today ?? todayIso();
  return answers[id];
}

// ─── Condiciones ─────────────────────────────────────────────

export function evalCondition(c: Condition, answers: Answers, ctx?: EvalContext): boolean {
  const v = valueOf(c.questionId, answers, ctx);
  const cv = c.value;
  switch (c.op) {
    case 'empty': return isEmpty(v);
    case 'not_empty': return !isEmpty(v);
    case 'eq':
      if (Array.isArray(v)) return v.includes(String(cv));
      if (typeof v === 'boolean' || typeof cv === 'boolean') return String(v) === String(cv);
      if (typeof v === 'number') return v === num(cv);
      return !isEmpty(v) && String(v).trim().toLowerCase() === String(cv ?? '').trim().toLowerCase();
    case 'neq':
      return !evalCondition({ ...c, op: 'eq' }, answers, ctx);
    case 'contains':
      if (Array.isArray(v)) return v.includes(String(cv));
      return !isEmpty(v) && String(v).toLowerCase().includes(String(cv ?? '').toLowerCase());
    case 'not_contains':
      return !evalCondition({ ...c, op: 'contains' }, answers, ctx);
    case 'gt': case 'lt': case 'gte': case 'lte': {
      const a = num(v); const b = num(cv);
      if (a === null || b === null) return false;
      if (c.op === 'gt') return a > b;
      if (c.op === 'lt') return a < b;
      if (c.op === 'gte') return a >= b;
      return a <= b;
    }
    case 'between': {
      const a = num(v);
      const [lo, hi] = Array.isArray(cv) ? cv : [null, null];
      if (a === null || lo === null || hi === null) return false;
      return a >= Math.min(lo, hi) && a <= Math.max(lo, hi);
    }
    case 'count_eq': case 'count_gte': case 'count_lte': {
      const n = Array.isArray(v) ? v.length : isEmpty(v) ? 0 : 1;
      const b = num(cv);
      if (b === null) return false;
      return c.op === 'count_eq' ? n === b : c.op === 'count_gte' ? n >= b : n <= b;
    }
    case 'before': case 'after': {
      const a = dateMs(v); const b = dateMs(cv === '$today' ? (ctx?.today ?? todayIso()) : cv);
      if (a === null || b === null) return false;
      return c.op === 'before' ? a < b : a > b;
    }
    case 'age_gte': case 'age_lte': {
      const age = ageYears(v, ctx?.today ?? todayIso()); const b = num(cv);
      if (age === null || b === null) return false;
      return c.op === 'age_gte' ? age >= b : age <= b;
    }
    default: return false;
  }
}

export function evalGroup(g: ConditionGroup | null | undefined, answers: Answers, ctx?: EvalContext): boolean {
  if (!g || g.conditions.length === 0) return true;
  const results = g.conditions.map(n => (isGroup(n) ? evalGroup(n, answers, ctx) : evalCondition(n, answers, ctx)));
  return g.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** Recorre todas las condiciones hoja de un grupo (incluye anidadas). */
export function flattenConditions(g: ConditionGroup | null | undefined): Condition[] {
  if (!g) return [];
  const out: Condition[] = [];
  for (const n of g.conditions) {
    if (isGroup(n)) out.push(...flattenConditions(n)); else out.push(n);
  }
  return out;
}

/** Opciones que se ofrecen dadas las respuestas actuales. */
export function visibleOptions(q: Question, answers: Answers, ctx?: EvalContext): ChoiceOption[] {
  return (q.options ?? []).filter(o => !o.showIf?.conditions.length || evalGroup(o.showIf, answers, ctx));
}

// ─── Flujo ───────────────────────────────────────────────────

export interface FlowOptions {
  lang?: Lang;
  today?: string;
  /** ids de preguntas que llegaron prellenadas por URL */
  prefilled?: Set<string>;
}

export interface FlowResult {
  path: string[];
  /** id del final alternativo, o null para el final por defecto */
  endingId: string | null;
}

/**
 * Lista ordenada de ids de pregunta que el invitado ve, dadas las
 * respuestas actuales, y en qué final termina.
 *
 * - Una pregunta con `showIf` falso se salta.
 * - Una pregunta prellenada por URL con skipIfPrefilled se salta.
 * - Después de una pregunta, la primera regla de salto que se cumple
 *   manda a otra pregunta o a un final.
 * - Los saltos hacia atrás se cortan para no ciclar.
 */
export function resolveFlowDetailed(schema: FormSchema, answers: Answers, opts?: FlowOptions): FlowResult {
  const qs = schema.questions.filter(isStep);
  const ctx: EvalContext = { lang: opts?.lang, score: computeScore(schema, answers), today: opts?.today };
  const path: string[] = [];
  const visited = new Set<string>();
  let endingId: string | null = null;
  let i = 0;

  while (i < qs.length) {
    const q = qs[i];
    if (visited.has(q.id)) break;
    visited.add(q.id);

    if (!evalGroup(q.showIf, answers, ctx)) { i++; continue; }
    if (q.skipIfPrefilled && opts?.prefilled?.has(q.id) && !isEmpty(answers[q.id])) { i++; continue; }
    path.push(q.id);

    const rule = (q.logic ?? []).find(r => r.conditions.length > 0 && evalGroup(r, answers, ctx));
    if (rule) {
      if (rule.jumpTo === 'end' || rule.jumpTo.startsWith('end:')) {
        endingId = rule.jumpTo.startsWith('end:') ? rule.jumpTo.slice(4) : null;
        break;
      }
      const idx = qs.findIndex(x => x.id === rule.jumpTo);
      if (idx > i) { i = idx; continue; }
      // destino inexistente o hacia atrás: seguimos en orden
    }
    i++;
  }
  return { path, endingId };
}

export function resolveFlow(schema: FormSchema, answers: Answers, opts?: FlowOptions): string[] {
  return resolveFlowDetailed(schema, answers, opts).path;
}

// ─── Validación de respuestas ────────────────────────────────

export type AnswerError =
  | 'required' | 'email' | 'phone' | 'number' | 'min' | 'max'
  | 'max_selections' | 'option' | 'date' | 'legal' | 'too_long';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_TEXT = 2000;

export function validateAnswer(q: Question, v: AnswerValue | undefined, answers?: Answers, ctx?: EvalContext): AnswerError | null {
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
      const ids = (answers ? visibleOptions(q, answers, ctx) : (q.options ?? [])).map(o => o.id);
      const s = String(v);
      if (ids.includes(s)) return null;
      return q.allowOther && s.startsWith('other:') ? null : 'option';
    }
    case 'multiple_choice': {
      const arr = Array.isArray(v) ? v : [String(v)];
      const ids = (answers ? visibleOptions(q, answers, ctx) : (q.options ?? [])).map(o => o.id);
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
export function validateSubmission(schema: FormSchema, answers: Answers, opts?: FlowOptions): {
  errors: Record<string, AnswerError>;
  clean: Answers;
  path: string[];
  endingId: string | null;
  score: number;
} {
  const { path, endingId } = resolveFlowDetailed(schema, answers, opts);
  const score = computeScore(schema, answers);
  const ctx: EvalContext = { lang: opts?.lang, score, today: opts?.today };
  const errors: Record<string, AnswerError> = {};
  const clean: Answers = {};
  const byId = new Map(schema.questions.map(q => [q.id, q]));

  for (const id of path) {
    const q = byId.get(id)!;
    const err = validateAnswer(q, answers[id], answers, ctx);
    if (err) errors[id] = err;
    if (!isEmpty(answers[id])) clean[id] = answers[id] as AnswerValue;
  }
  for (const q of schema.questions) {
    // Ocultas y prellenadas que se saltaron se conservan
    if ((q.type === 'hidden' || q.skipIfPrefilled) && !isEmpty(answers[q.id]) && clean[q.id] === undefined) {
      clean[q.id] = typeof answers[q.id] === 'string' ? String(answers[q.id]).slice(0, 200) : (answers[q.id] as AnswerValue);
    }
  }
  return { errors, clean, path, endingId, score };
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

// ─── Grafo del flujo (vista de nodos y linter) ───────────────

export interface FlowEdge {
  id: string;
  source: string;        // 'start' | questionId
  target: string;        // questionId | 'end' | 'end:<id>'
  kind: 'next' | 'else' | 'branch' | 'jump';
  /** Condición que abre esta salida (branch / jump) */
  group?: ConditionGroup;
}

const SINGLE_ANSWER = new Set<QuestionType>(['single_choice', 'dropdown', 'yes_no', 'legal', 'short_text', 'long_text', 'email', 'phone', 'number', 'date', 'rating', 'hidden']);

/** Dos grupos "solo si" que no pueden cumplirse a la vez (misma pregunta, valores distintos). */
export function exclusiveGroups(a: ConditionGroup, b: ConditionGroup, byId: Map<string, Question>): boolean {
  if (a.match === 'any' && a.conditions.length > 1) return false;
  if (b.match === 'any' && b.conditions.length > 1) return false;
  for (const ca of flattenConditions(a)) for (const cb of flattenConditions(b)) {
    if (ca.questionId !== cb.questionId) continue;
    const q = byId.get(ca.questionId);
    const single = isSpecialVar(ca.questionId) || (q ? SINGLE_ANSWER.has(q.type) : false);
    if (!single) continue;
    const va = String(ca.value); const vb = String(cb.value);
    if (ca.op === 'eq' && cb.op === 'eq' && va !== vb) return true;
    if ((ca.op === 'eq' && cb.op === 'neq' && va === vb) || (ca.op === 'neq' && cb.op === 'eq' && va === vb)) return true;
    if ((ca.op === 'empty' && cb.op === 'not_empty') || (ca.op === 'not_empty' && cb.op === 'empty')) return true;
  }
  return false;
}

/** Un grupo "todas" con dos condiciones contradictorias sobre la misma pregunta nunca se cumple. */
export function isImpossibleGroup(g: ConditionGroup | null | undefined, byId: Map<string, Question>): boolean {
  if (!g) return false;
  if (g.match === 'all') {
    const leaves = g.conditions.filter((n): n is Condition => !isGroup(n));
    for (let a = 0; a < leaves.length; a++) for (let b = a + 1; b < leaves.length; b++) {
      if (exclusiveGroups({ match: 'all', conditions: [leaves[a]] }, { match: 'all', conditions: [leaves[b]] }, byId)) return true;
    }
    return g.conditions.some(n => isGroup(n) && isImpossibleGroup(n, byId));
  }
  return g.conditions.length > 0 && g.conditions.every(n => isGroup(n) && isImpossibleGroup(n, byId));
}

/**
 * Salidas de cada pregunta: las preguntas posteriores con "solo si" son
 * ramas etiquetadas hasta topar con una incondicional (la salida "si no").
 * Las ramas hermanas excluyentes no se enlazan entre sí.
 */
export function buildFlowGraph(schema: FormSchema): FlowEdge[] {
  const steps = schema.questions.filter(isStep);
  const byId = new Map(schema.questions.map(q => [q.id, q]));
  const edges: FlowEdge[] = [];
  if (steps.length === 0) return [{ id: 'e-start-end', source: 'start', target: 'end', kind: 'next' }];
  edges.push({ id: 'e-start', source: 'start', target: steps[0].id, kind: 'next' });

  steps.forEach((q, i) => {
    const rules = (q.logic ?? []).filter(r => r.conditions.length > 0);
    for (const r of rules) {
      const target = r.jumpTo === 'end' || r.jumpTo.startsWith('end:') || byId.has(r.jumpTo) ? r.jumpTo : 'end';
      edges.push({ id: `j-${q.id}-${r.id}`, source: q.id, target, kind: 'jump', group: r });
    }
    let hasBranch = false;
    let defaultTarget = 'end';
    for (let j = i + 1; j < steps.length; j++) {
      const n = steps[j];
      if (n.showIf?.conditions.length) {
        if (isImpossibleGroup(n.showIf, byId)) continue;            // nunca se muestra
        if (q.showIf?.conditions.length && exclusiveGroups(q.showIf, n.showIf, byId)) continue;
        edges.push({ id: `b-${q.id}-${n.id}`, source: q.id, target: n.id, kind: 'branch', group: n.showIf });
        hasBranch = true;
        continue;
      }
      defaultTarget = n.id;
      break;
    }
    edges.push({ id: `n-${q.id}-${defaultTarget}`, source: q.id, target: defaultTarget, kind: hasBranch || rules.length ? 'else' : 'next' });
  });
  return edges;
}

/** Todos los caminos posibles de start a un final (acotado). */
export function enumeratePaths(schema: FormSchema, limit = 200): string[][] {
  const edges = buildFlowGraph(schema);
  const out = new Map<string, FlowEdge[]>();
  for (const e of edges) { if (!out.has(e.source)) out.set(e.source, []); out.get(e.source)!.push(e); }
  const paths: string[][] = [];
  const walk = (node: string, acc: string[]) => {
    if (paths.length >= limit) return;
    if (node === 'end' || node.startsWith('end:')) { paths.push([...acc, node]); return; }
    for (const e of out.get(node) ?? []) {
      if (acc.includes(e.target)) continue;
      walk(e.target, [...acc, node]);
    }
  };
  walk('start', []);
  return paths;
}

// ─── Linter del esquema (al publicar y en vivo) ──────────────

export type IssueCode =
  | 'no_questions' | 'missing_title' | 'no_options' | 'option_empty' | 'option_duplicate' | 'hidden_no_key'
  | 'identity_duplicate' | 'ref_missing' | 'jump_backward' | 'jump_self' | 'op_invalid' | 'value_missing'
  | 'option_ref_missing' | 'impossible' | 'unreachable' | 'duplicate_title' | 'duplicate_options'
  | 'email_not_identity' | 'phone_not_identity' | 'no_name' | 'no_contact' | 'same_text_langs'
  | 'ending_missing' | 'endings_unused' | 'key_duplicate';

export interface SchemaIssue {
  questionId?: string;
  level: 'error' | 'warning';
  code: IssueCode;
  message: string;
}

const normTitle = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function validateSchema(schema: FormSchema, langs: Lang[]): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const push = (level: SchemaIssue['level'], code: IssueCode, message: string, questionId?: string) => issues.push({ level, code, message, questionId });
  const qs = schema.questions;
  const ids = new Set(qs.map(q => q.id));
  const byId = new Map(qs.map(q => [q.id, q]));
  const steps = qs.filter(isStep);
  const indexOf = new Map(qs.map((q, i) => [q.id, i]));
  const endings = schema.settings.endings ?? [];
  const endingIds = new Set(endings.map(e => e.id));
  const lang = langs[0] ?? 'es';
  const label = (q: Question) => `Pregunta ${(indexOf.get(q.id) ?? 0) + 1}`;

  if (steps.length === 0) {
    push('error', 'no_questions', 'El formulario no tiene preguntas.');
    return issues;
  }

  // ── Condiciones: referencias, operadores, valores, imposibles
  const checkGroup = (g: ConditionGroup | null | undefined, owner: Question, what: string) => {
    if (!g) return;
    for (const c of flattenConditions(g)) {
      if (isSpecialVar(c.questionId)) {
        const sv = SPECIAL_VARS.find(s => s.id === c.questionId);
        if (!sv) push('error', 'ref_missing', `${label(owner)}: ${what} usa una variable desconocida (${c.questionId}).`, owner.id);
        else if (!opsForType(sv.kind).includes(c.op)) push('error', 'op_invalid', `${label(owner)}: ${what} usa un operador que no aplica a "${text(sv.label, lang)}".`, owner.id);
        continue;
      }
      const ref = byId.get(c.questionId);
      if (!ref) { push('error', 'ref_missing', `${label(owner)}: ${what} apunta a una pregunta que ya no existe.`, owner.id); continue; }
      if ((indexOf.get(ref.id) ?? 0) >= (indexOf.get(owner.id) ?? 0) && ref.type !== 'hidden' && ref.id !== owner.id) {
        push('warning', 'ref_missing', `${label(owner)}: ${what} depende de "${text(ref.title, lang) || label(ref)}", que viene después y aún no estará respondida.`, owner.id);
      }
      if (!opsForType(ref.type).includes(c.op)) push('error', 'op_invalid', `${label(owner)}: ${what} usa "${c.op}" sobre una pregunta de tipo ${ref.type}, que no lo admite.`, owner.id);
      const needsValue = !['empty', 'not_empty'].includes(c.op);
      if (needsValue && (c.value === undefined || c.value === '' || c.value === null)) push('error', 'value_missing', `${label(owner)}: ${what} tiene una condición sin valor.`, owner.id);
      if (needsValue && isChoice(ref.type) && ['eq', 'neq', 'contains', 'not_contains'].includes(c.op)) {
        if (!(ref.options ?? []).some(o => o.id === String(c.value))) push('error', 'option_ref_missing', `${label(owner)}: ${what} apunta a una opción que ya no existe en "${text(ref.title, lang) || label(ref)}".`, owner.id);
      }
    }
    if (isImpossibleGroup(g, byId)) push('error', 'impossible', `${label(owner)}: ${what} nunca se cumple (dos condiciones contradictorias sobre la misma pregunta).`, owner.id);
  };

  const seenIdentity = new Map<Identity, Question>();
  const seenKeys = new Map<string, Question>();
  const titleMap = new Map<string, Question>();
  const optionSets = new Map<string, Question>();

  qs.forEach((q) => {
    for (const l of langs) {
      if (q.type !== 'hidden' && !text(q.title, l).trim()) push('error', 'missing_title', `${label(q)}: falta el título en ${l.toUpperCase()}.`, q.id);
    }
    if (langs.length > 1 && q.type !== 'hidden') {
      const a = (q.title.es ?? '').trim(); const b = (q.title.en ?? '').trim();
      if (a && a === b) push('warning', 'same_text_langs', `${label(q)}: el título es idéntico en ES y EN; parece sin traducir.`, q.id);
    }
    if (isChoice(q.type)) {
      const opts = q.options ?? [];
      if (opts.length === 0) push('error', 'no_options', `${label(q)}: agrega al menos una opción.`, q.id);
      const seenOpt = new Set<string>();
      opts.forEach((o, oi) => {
        for (const l of langs) if (!text(o.label, l).trim()) push('error', 'option_empty', `${label(q)}, opción ${oi + 1}: falta el texto en ${l.toUpperCase()}.`, q.id);
        const k = normTitle(text(o.label, lang));
        if (k && seenOpt.has(k)) push('error', 'option_duplicate', `${label(q)}: la opción "${text(o.label, lang)}" está repetida.`, q.id);
        seenOpt.add(k);
        if (o.showIf?.conditions.length) checkGroup(o.showIf, q, `la condición de la opción "${text(o.label, lang)}"`);
      });
      const setKey = Array.from(seenOpt).sort().join('|');
      if (opts.length >= 2 && setKey) {
        const other = optionSets.get(setKey);
        if (other) push('warning', 'duplicate_options', `${label(q)} tiene exactamente las mismas opciones que ${label(other)}; revisa si está duplicada.`, q.id);
        else optionSets.set(setKey, q);
      }
    }
    if (q.type === 'hidden' && !(q.key ?? '').trim()) push('error', 'hidden_no_key', `${label(q)}: el campo oculto necesita el nombre del parámetro de URL.`, q.id);
    if (q.key) {
      const prev = seenKeys.get(q.key);
      if (prev) push('error', 'key_duplicate', `${label(q)}: el parámetro de URL "${q.key}" ya lo usa ${label(prev)}.`, q.id);
      else seenKeys.set(q.key, q);
    }
    if (q.identity) {
      const prev = seenIdentity.get(q.identity);
      if (prev) push('error', 'identity_duplicate', `${label(q)}: ya hay otra pregunta marcada como "${q.identity}" (${label(prev)}).`, q.id);
      else seenIdentity.set(q.identity, q);
    }
    if (q.type !== 'hidden') {
      const k = normTitle(text(q.title, lang));
      if (k) {
        const prev = titleMap.get(k);
        if (prev) push('warning', 'duplicate_title', `${label(q)} y ${label(prev)} tienen el mismo título.`, q.id);
        else titleMap.set(k, q);
      }
    }
    checkGroup(q.showIf, q, 'la condición "mostrar solo si"');
    for (const r of q.logic ?? []) {
      checkGroup(r, q, 'una regla de salto');
      if (r.jumpTo === q.id) push('error', 'jump_self', `${label(q)}: un salto apunta a la misma pregunta.`, q.id);
      else if (r.jumpTo.startsWith('end:')) {
        if (!endingIds.has(r.jumpTo.slice(4))) push('error', 'ending_missing', `${label(q)}: un salto apunta a un final que ya no existe.`, q.id);
      } else if (r.jumpTo !== 'end') {
        if (!ids.has(r.jumpTo)) push('error', 'ref_missing', `${label(q)}: un salto apunta a una pregunta que ya no existe.`, q.id);
        else if ((indexOf.get(r.jumpTo) ?? 0) < (indexOf.get(q.id) ?? 0)) push('error', 'jump_backward', `${label(q)}: un salto va hacia atrás (a ${label(byId.get(r.jumpTo)!)}); eso crearía un ciclo.`, q.id);
      }
    }
  });

  // ── Alcanzabilidad
  const edges = buildFlowGraph(schema);
  const reachable = new Set<string>(['start']);
  const queue = ['start'];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of edges) if (e.source === n && !reachable.has(e.target)) { reachable.add(e.target); queue.push(e.target); }
  }
  for (const q of steps) {
    if (!reachable.has(q.id)) push('warning', 'unreachable', `${label(q)} nunca se muestra: ninguna rama llega a ella.`, q.id);
  }
  // Finales definidos pero sin uso
  for (const e of endings) {
    if (!qs.some(q => (q.logic ?? []).some(r => r.jumpTo === `end:${e.id}`))) push('warning', 'endings_unused', `El final "${e.name || text(e.title, lang) || e.id}" no lo usa ningún salto.`);
  }

  // ── Identidades y contacto
  if (!seenIdentity.has('name')) push('warning', 'no_name', 'Ninguna pregunta está marcada como "nombre": los registros se verán sin nombre en la lista.');
  if (!seenIdentity.has('email') && !seenIdentity.has('phone')) push('warning', 'no_contact', 'Sin correo ni teléfono marcados como identidad no podrás enviar confirmaciones ni invitaciones.');
  for (const q of qs) {
    if (q.type === 'email' && !q.identity && !seenIdentity.has('email')) push('warning', 'email_not_identity', `${label(q)} pide correo pero no está marcada como "correo": no se usará para enviar mensajes.`, q.id);
    if (q.type === 'phone' && !q.identity && !seenIdentity.has('phone')) push('warning', 'phone_not_identity', `${label(q)} pide teléfono pero no está marcada como "teléfono".`, q.id);
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
