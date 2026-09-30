// Tipos y motor de filtros del panel de registros.
// Los registros de un evento son cientos o pocos miles: se cargan
// completos y se filtran en memoria, que es instantáneo y permite
// cruzar cualquier pregunta sin consultas especiales.

import { type FormSchema, type Question, type Answers, type AnswerValue, type Lang, type ConditionOp, text, isEmpty, answerToText } from './form-types';

export type RegistrationStatus = 'registered' | 'waitlist' | 'selected' | 'invited' | 'confirmed' | 'checked_in' | 'cancelled';

export interface Registration {
  id: string;
  event_id: string;
  form_version: number | null;
  submission_id: string | null;
  answers: Answers;
  lang: Lang;
  name: string | null;
  email: string | null;
  phone: string | null;
  party_size: number;
  company: string | null;
  status: RegistrationStatus;
  tags: string[];
  notes: string | null;
  source: Record<string, string>;
  qr_token: string | null;
  qr_url: string | null;
  invitation_url: string | null;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABEL: Record<RegistrationStatus, string> = {
  registered: 'Registrado',
  waitlist: 'Lista de espera',
  selected: 'Seleccionado',
  invited: 'Invitado',
  confirmed: 'Confirmado',
  checked_in: 'Asistió',
  cancelled: 'Cancelado',
};

export const STATUS_ORDER: RegistrationStatus[] = ['registered', 'waitlist', 'selected', 'invited', 'confirmed', 'checked_in', 'cancelled'];

/** Reusa los badges de index.css */
export const STATUS_BADGE: Record<RegistrationStatus, string> = {
  registered: 'badge-nuevo',
  waitlist: 'badge-pendiente',
  selected: 'badge-cotizado',
  invited: 'badge-enviada',
  confirmed: 'badge-aceptada',
  checked_in: 'badge-finalizado',
  cancelled: 'badge-rechazada',
};

// ─── Columnas ────────────────────────────────────────────────

export type ColumnKey = 'name' | 'email' | 'phone' | 'party_size' | 'company' | 'status' | 'tags' | 'lang' | 'created_at' | `q:${string}`;

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  question?: Question;
}

export const FIXED_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'email', label: 'Correo' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'party_size', label: 'Personas' },
  { key: 'company', label: 'Empresa' },
  { key: 'status', label: 'Estatus' },
  { key: 'tags', label: 'Etiquetas' },
  { key: 'lang', label: 'Idioma' },
  { key: 'created_at', label: 'Registrado' },
];

export const DEFAULT_COLUMNS: ColumnKey[] = ['name', 'email', 'phone', 'party_size', 'status', 'tags', 'created_at'];

/** Columnas disponibles: fijas + una por pregunta (sin identidad, que ya tienen columna). */
export function allColumns(schema: FormSchema | null, lang: Lang): ColumnDef[] {
  const qs = (schema?.questions ?? []).filter(q => q.type !== 'statement' && !q.identity);
  return [
    ...FIXED_COLUMNS,
    ...qs.map(q => ({ key: `q:${q.id}` as ColumnKey, label: text(q.title, lang) || (q.type === 'hidden' ? `oculto: ${q.key}` : 'Pregunta'), question: q })),
  ];
}

/** Valor legible de una celda. */
export function cellText(r: Registration, col: ColumnDef, lang: Lang): string {
  switch (col.key) {
    case 'name': return r.name ?? '';
    case 'email': return r.email ?? '';
    case 'phone': return r.phone ?? '';
    case 'party_size': return String(r.party_size ?? 1);
    case 'company': return r.company ?? '';
    case 'status': return STATUS_LABEL[r.status];
    case 'tags': return r.tags.join(', ');
    case 'lang': return r.lang.toUpperCase();
    case 'created_at': return new Date(r.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
    default:
      return col.question ? answerText(col.question, r.answers[col.question.id], lang) : '';
  }
}

export const answerText = answerToText;

// ─── Filtros ─────────────────────────────────────────────────

export type FilterOp = ConditionOp | 'before' | 'after';

export interface Filter {
  id: string;
  /** Columna fija o 'q:<id>' */
  column: ColumnKey;
  op: FilterOp;
  value?: string | number | boolean;
}

export interface ViewConfig {
  search: string;
  match: 'all' | 'any';
  filters: Filter[];
  sort: { key: ColumnKey; dir: 'asc' | 'desc' };
  columns: ColumnKey[];
}

export const DEFAULT_VIEW: ViewConfig = {
  search: '',
  match: 'all',
  filters: [],
  sort: { key: 'created_at', dir: 'desc' },
  columns: DEFAULT_COLUMNS,
};

export const FILTER_OP_LABEL: Record<FilterOp, string> = {
  eq: 'es', neq: 'no es', contains: 'contiene', not_contains: 'no contiene',
  gt: 'mayor que', lt: 'menor que', gte: 'mayor o igual', lte: 'menor o igual',
  empty: 'está vacío', not_empty: 'tiene valor', before: 'antes de', after: 'después de',
};

export function opsForColumn(col: ColumnDef): FilterOp[] {
  if (col.question) {
    switch (col.question.type) {
      case 'single_choice': case 'dropdown': case 'yes_no': case 'legal': return ['eq', 'neq', 'empty', 'not_empty'];
      case 'multiple_choice': return ['contains', 'not_contains', 'empty', 'not_empty'];
      case 'number': case 'rating': return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'not_empty'];
      case 'date': return ['eq', 'before', 'after', 'empty', 'not_empty'];
      default: return ['contains', 'not_contains', 'eq', 'empty', 'not_empty'];
    }
  }
  switch (col.key) {
    case 'status': case 'lang': return ['eq', 'neq'];
    case 'tags': return ['contains', 'not_contains', 'empty', 'not_empty'];
    case 'party_size': return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'];
    case 'created_at': return ['before', 'after'];
    default: return ['contains', 'not_contains', 'eq', 'empty', 'not_empty'];
  }
}

function rawValue(r: Registration, col: ColumnDef): AnswerValue | undefined {
  switch (col.key) {
    case 'name': return r.name;
    case 'email': return r.email;
    case 'phone': return r.phone;
    case 'party_size': return r.party_size;
    case 'company': return r.company;
    case 'status': return r.status;
    case 'tags': return r.tags;
    case 'lang': return r.lang;
    case 'created_at': return r.created_at;
    default: return col.question ? r.answers[col.question.id] : undefined;
  }
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function evalFilter(r: Registration, f: Filter, cols: Map<ColumnKey, ColumnDef>): boolean {
  const col = cols.get(f.column);
  if (!col) return true;
  const v = rawValue(r, col);
  const fv = f.value;
  switch (f.op) {
    case 'empty': return isEmpty(v);
    case 'not_empty': return !isEmpty(v);
    case 'eq':
      if (Array.isArray(v)) return v.includes(String(fv));
      if (typeof v === 'boolean' || typeof fv === 'boolean') return String(v) === String(fv);
      if (typeof v === 'number') return v === Number(fv);
      return norm(v) === norm(fv);
    case 'neq': return !evalFilter(r, { ...f, op: 'eq' }, cols);
    case 'contains':
      if (Array.isArray(v)) return v.some(x => norm(x) === norm(fv) || norm(x).includes(norm(fv)));
      return !isEmpty(v) && norm(v).includes(norm(fv));
    case 'not_contains': return !evalFilter(r, { ...f, op: 'contains' }, cols);
    case 'gt': case 'lt': case 'gte': case 'lte': {
      const a = Number(v); const b = Number(fv);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return f.op === 'gt' ? a > b : f.op === 'lt' ? a < b : f.op === 'gte' ? a >= b : a <= b;
    }
    case 'before': case 'after': {
      if (isEmpty(v) || !fv) return false;
      const a = Date.parse(String(v)); const b = Date.parse(String(fv));
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return f.op === 'before' ? a < b : a > b;
    }
    default: return true;
  }
}

function matchesSearch(r: Registration, q: string, schema: FormSchema | null, lang: Lang): boolean {
  if (!q) return true;
  const hay = [r.name, r.email, r.phone, r.company, r.tags.join(' '), STATUS_LABEL[r.status]];
  for (const question of schema?.questions ?? []) {
    if (!question.identity) hay.push(answerText(question, r.answers[question.id], lang));
  }
  const n = norm(q);
  return hay.some(h => norm(h).includes(n));
}

export function applyView(regs: Registration[], view: ViewConfig, schema: FormSchema | null, lang: Lang): Registration[] {
  const cols = new Map(allColumns(schema, lang).map(c => [c.key, c]));
  const out = regs.filter(r => {
    if (!matchesSearch(r, view.search, schema, lang)) return false;
    if (view.filters.length === 0) return true;
    const results = view.filters.map(f => evalFilter(r, f, cols));
    return view.match === 'any' ? results.some(Boolean) : results.every(Boolean);
  });
  const sortCol = cols.get(view.sort.key);
  if (sortCol) {
    const dir = view.sort.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const va = rawValue(a, sortCol); const vb = rawValue(b, sortCol);
      if (isEmpty(va) && isEmpty(vb)) return 0;
      if (isEmpty(va)) return 1;
      if (isEmpty(vb)) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      if (sortCol.key === 'status') return (STATUS_ORDER.indexOf(va as RegistrationStatus) - STATUS_ORDER.indexOf(vb as RegistrationStatus)) * dir;
      return norm(Array.isArray(va) ? va.join(',') : va).localeCompare(norm(Array.isArray(vb) ? vb.join(',') : vb)) * dir;
    });
  }
  return out;
}

// ─── Exportar ────────────────────────────────────────────────

export function toCsv(regs: Registration[], cols: ColumnDef[], lang: Lang): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [cols.map(c => esc(c.label)).join(',')];
  for (const r of regs) lines.push(cols.map(c => esc(cellText(r, c, lang))).join(','));
  return '﻿' + lines.join('\r\n');
}

export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function uidFilter(): string {
  return `f_${Math.random().toString(36).slice(2, 9)}`;
}
