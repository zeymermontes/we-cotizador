// Exportación de respuestas a Excel: todo lo que capturó el formulario más
// los datos del registro, en un .xlsx que abre bien con acentos (a diferencia
// del CSV en Excel para Mac).
import * as XLSX from 'xlsx';
import type { FormSchema, Lang } from './form-types';
import { text, answerToText } from './form-types';
import type { Registration } from './registrations';
import { STATUS_LABEL } from './registrations';
import type { EventRow } from './events-types';

/** Una fila por registro; una columna por pregunta (incluye identidad y ocultas). */
export function buildAnswerRows(schema: FormSchema | null, regs: Registration[], lang: Lang): Record<string, string | number>[] {
  const qs = (schema?.questions ?? []).filter(q => q.type !== 'statement');
  const seen = new Map<string, number>();
  const header = (q: typeof qs[number]) => {
    const base = text(q.title, lang) || (q.type === 'hidden' ? `oculto: ${q.key ?? q.id}` : 'Pregunta');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  };
  const headers = qs.map(q => ({ q, h: header(q) }));
  return regs.map(r => {
    const row: Record<string, string | number> = {
      'Nombre': r.name ?? '',
      'Correo': r.email ?? '',
      'Teléfono': r.phone ?? '',
      'Personas': r.party_size ?? 1,
      'Empresa': r.company ?? '',
      'Estatus': STATUS_LABEL[r.status],
      'Etiquetas': r.tags.join(', '),
      'Idioma': r.lang.toUpperCase(),
      'Registrado': new Date(r.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }),
    };
    for (const { q, h } of headers) row[h] = answerToText(q, r.answers[q.id], lang);
    row['Notas'] = r.notes ?? '';
    row['Origen'] = Object.entries(r.source ?? {}).filter(([k]) => k !== 'ua' && k !== 'referrer').map(([k, v]) => `${k}=${v}`).join(' · ');
    row['QR'] = r.qr_url ?? '';
    row['Invitación'] = r.invitation_url ?? '';
    row['ID'] = r.id;
    return row;
  });
}

export function downloadAnswersExcel(event: EventRow, schema: FormSchema | null, regs: Registration[], lang: Lang, suffix: string) {
  const rows = buildAnswerRows(schema, regs, lang);
  const ws = XLSX.utils.json_to_sheet(rows);
  // Anchos razonables: según el contenido más largo de cada columna, con tope
  const keys = rows.length ? Object.keys(rows[0]) : [];
  ws['!cols'] = keys.map(k => ({ wch: Math.min(60, Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Respuestas');
  if (schema) {
    const guide = schema.questions.filter(q => q.type !== 'statement').map((q, i) => ({ '#': i + 1, 'Pregunta': text(q.title, lang), 'Tipo': q.type, 'Obligatoria': q.required ? 'Sí' : 'No', 'ID': q.id }));
    const ws2 = XLSX.utils.json_to_sheet(guide);
    ws2['!cols'] = [{ wch: 4 }, { wch: 50 }, { wch: 16 }, { wch: 12 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Preguntas');
  }
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${event.slug}-respuestas-${suffix}-${stamp}.xlsx`);
}
