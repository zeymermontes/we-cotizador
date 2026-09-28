// Catálogo de tipos de pregunta y helpers del builder.
// El motor (tipos, flujo, validación) vive en supabase/functions/_shared/form-engine.ts
// para que navegador y edge function compartan exactamente el mismo código.

export * from '../../supabase/functions/_shared/form-engine.ts';
import type { Question, QuestionType, Identity, ConditionOp, Lang, Localized, ChoiceOption, AnswerError } from '../../supabase/functions/_shared/form-engine.ts';

export interface QuestionTypeInfo {
  type: QuestionType;
  label: string;
  hint: string;
  icon: string;
  group: 'texto' | 'opciones' | 'otros';
}

export const QUESTION_TYPES: QuestionTypeInfo[] = [
  { type: 'short_text', label: 'Texto corto', hint: 'Nombre, ciudad, empresa…', icon: 'Aa', group: 'texto' },
  { type: 'long_text', label: 'Texto largo', hint: 'Comentarios, mensajes', icon: '¶', group: 'texto' },
  { type: 'email', label: 'Correo', hint: 'Valida el formato', icon: '@', group: 'texto' },
  { type: 'phone', label: 'Teléfono', hint: 'Con selector de país', icon: '☎', group: 'texto' },
  { type: 'number', label: 'Número', hint: 'Acompañantes, edad…', icon: '#', group: 'texto' },
  { type: 'single_choice', label: 'Opción única', hint: 'Tarjetas, elige una', icon: '◉', group: 'opciones' },
  { type: 'multiple_choice', label: 'Opción múltiple', hint: 'Elige varias', icon: '☑', group: 'opciones' },
  { type: 'dropdown', label: 'Lista desplegable', hint: 'Muchas opciones', icon: '▾', group: 'opciones' },
  { type: 'yes_no', label: 'Sí / No', hint: 'Respuesta binaria', icon: '⇄', group: 'opciones' },
  { type: 'date', label: 'Fecha', hint: 'Calendario', icon: '📅', group: 'otros' },
  { type: 'rating', label: 'Calificación', hint: 'Estrellas o escala', icon: '★', group: 'otros' },
  { type: 'legal', label: 'Aceptación', hint: 'Aviso de privacidad, términos', icon: '✓', group: 'otros' },
  { type: 'statement', label: 'Pantalla informativa', hint: 'Texto sin respuesta', icon: 'ℹ', group: 'otros' },
  { type: 'hidden', label: 'Campo oculto', hint: 'Se llena desde la URL (utm, ref)', icon: '⌁', group: 'otros' },
];

export const TYPE_INFO: Record<QuestionType, QuestionTypeInfo> = Object.fromEntries(
  QUESTION_TYPES.map(t => [t.type, t]),
) as Record<QuestionType, QuestionTypeInfo>;

export const IDENTITY_LABEL: Record<Identity, string> = {
  name: 'Nombre del invitado',
  email: 'Correo',
  phone: 'Teléfono',
  party_size: 'Número de personas',
  company: 'Empresa / organización',
};

/** Qué identidades tienen sentido para cada tipo. */
export function identityOptionsFor(type: QuestionType): Identity[] {
  switch (type) {
    case 'short_text': return ['name', 'company'];
    case 'email': return ['email'];
    case 'phone': return ['phone'];
    case 'number': return ['party_size'];
    case 'single_choice': case 'dropdown': return ['party_size', 'company'];
    default: return [];
  }
}

export const OP_LABEL: Record<ConditionOp, string> = {
  eq: 'es',
  neq: 'no es',
  contains: 'contiene',
  not_contains: 'no contiene',
  gt: 'es mayor que',
  lt: 'es menor que',
  gte: 'es mayor o igual que',
  lte: 'es menor o igual que',
  empty: 'está vacía',
  not_empty: 'tiene respuesta',
};

export function opsFor(type: QuestionType): ConditionOp[] {
  switch (type) {
    case 'single_choice': case 'dropdown': case 'yes_no': return ['eq', 'neq', 'empty', 'not_empty'];
    case 'multiple_choice': return ['contains', 'not_contains', 'empty', 'not_empty'];
    case 'number': case 'rating': return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'not_empty'];
    case 'legal': return ['eq', 'empty', 'not_empty'];
    case 'statement': return [];
    default: return ['eq', 'neq', 'contains', 'not_contains', 'empty', 'not_empty'];
  }
}

export const ERROR_TEXT: Record<Lang, Record<AnswerError, string>> = {
  es: {
    required: 'Esta pregunta es obligatoria.',
    email: 'Escribe un correo válido.',
    phone: 'Escribe un teléfono válido.',
    number: 'Escribe un número.',
    min: 'El valor es menor al mínimo permitido.',
    max: 'El valor es mayor al máximo permitido.',
    max_selections: 'Elegiste más opciones de las permitidas.',
    option: 'Elige una opción.',
    date: 'Elige una fecha válida.',
    legal: 'Necesitas aceptar para continuar.',
    too_long: 'El texto es demasiado largo.',
  },
  en: {
    required: 'This question is required.',
    email: 'Enter a valid email.',
    phone: 'Enter a valid phone number.',
    number: 'Enter a number.',
    min: 'The value is below the minimum.',
    max: 'The value is above the maximum.',
    max_selections: 'You selected more options than allowed.',
    option: 'Choose an option.',
    date: 'Choose a valid date.',
    legal: 'You need to accept to continue.',
    too_long: 'The text is too long.',
  },
};

export const RUNNER_TEXT: Record<Lang, Record<string, string>> = {
  es: {
    ok: 'OK', next: 'Siguiente', back: 'Atrás', submit: 'Enviar', continue: 'Continuar',
    press_enter: 'presiona Enter ↵', press_cmd_enter: 'Ctrl + Enter para continuar',
    step: 'Pregunta', of: 'de', yes: 'Sí', no: 'No', accept: 'Acepto', other: 'Otro',
    other_placeholder: 'Escribe tu respuesta', choose: 'Elige una opción', choose_many: 'Puedes elegir varias',
    choose_up_to: 'Elige hasta {{n}}', sending: 'Enviando…', optional: 'opcional',
    error_generic: 'No pudimos guardar tu registro. Intenta de nuevo.', retry: 'Reintentar',
    duplicate: 'Ya existe un registro con estos datos.', full: 'El cupo está lleno.', closed: 'El registro ya cerró.',
  },
  en: {
    ok: 'OK', next: 'Next', back: 'Back', submit: 'Submit', continue: 'Continue',
    press_enter: 'press Enter ↵', press_cmd_enter: 'Ctrl + Enter to continue',
    step: 'Question', of: 'of', yes: 'Yes', no: 'No', accept: 'I accept', other: 'Other',
    other_placeholder: 'Type your answer', choose: 'Choose one option', choose_many: 'Choose as many as you like',
    choose_up_to: 'Choose up to {{n}}', sending: 'Sending…', optional: 'optional',
    error_generic: 'We could not save your registration. Please try again.', retry: 'Retry',
    duplicate: 'There is already a registration with these details.', full: 'The event is full.', closed: 'Registration is closed.',
  },
};

/** Letra de atajo para la opción i: A, B, C… */
export const letterFor = (i: number) => String.fromCharCode(65 + (i % 26));

// ─── Constructores ───────────────────────────────────────────

export function uid(prefix = 'q'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

function loc(langs: Lang[], es: string, en: string): Localized {
  const out: Localized = {};
  if (langs.includes('es')) out.es = es;
  if (langs.includes('en')) out.en = en;
  return out;
}

export function newOption(langs: Lang[], es = '', en = ''): ChoiceOption {
  return { id: uid('o'), label: loc(langs, es, en) };
}

export function newQuestion(type: QuestionType, langs: Lang[]): Question {
  const base: Question = { id: uid(), type, title: loc(langs, '', ''), required: type !== 'statement' && type !== 'hidden' };
  switch (type) {
    case 'single_choice':
    case 'multiple_choice':
    case 'dropdown':
      return { ...base, options: [newOption(langs, 'Opción 1', 'Option 1'), newOption(langs, 'Opción 2', 'Option 2')] };
    case 'email':
      return { ...base, title: loc(langs, '¿Cuál es tu correo?', 'What is your email?'), identity: 'email' };
    case 'phone':
      return { ...base, title: loc(langs, '¿Cuál es tu WhatsApp?', 'What is your WhatsApp?'), identity: 'phone' };
    case 'rating':
      return { ...base, ratingSteps: 5, ratingIcon: 'star' };
    case 'legal':
      return { ...base, title: loc(langs, 'Acepto el aviso de privacidad', 'I accept the privacy notice') };
    case 'statement':
      return { ...base, buttonLabel: loc(langs, 'Continuar', 'Continue') };
    case 'hidden':
      return { ...base, key: 'utm_source' };
    default:
      return base;
  }
}

/** Formulario inicial sugerido al abrir el builder por primera vez. */
export function starterQuestions(langs: Lang[]): Question[] {
  const name = newQuestion('short_text', langs);
  name.title = loc(langs, '¿Cuál es tu nombre completo?', 'What is your full name?');
  name.identity = 'name';
  const email = newQuestion('email', langs);
  const phone = newQuestion('phone', langs);
  return [name, email, phone];
}
