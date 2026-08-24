import { unwrapGoogleRedirect } from "./google.ts";

const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const SPACE = 0x20;
const WS = new Set([0x20, 0x0a, 0x0d, 0x09, 0x00, 0x0c]);

/**
 * Reescribe los enlaces del PDF exportado para que abran directo.
 *
 * Google no guarda el redirector en la presentación: lo inyecta al exportar a
 * PDF. Así que el único sitio donde se puede quitar es en los bytes del PDF ya
 * generado, sobre las anotaciones `/URI (...)`.
 *
 * Se escribe EN SITIO y se rellena con espacios hasta ocupar exactamente los
 * mismos bytes: si el archivo cambiara de tamaño, todos los desplazamientos de
 * la tabla xref quedarían mal y el PDF se corrompería. El destino directo
 * siempre es más corto que el envuelto, así que siempre cabe.
 */
export function unwrapPdfLinks(bytes: Uint8Array): number {
  let rewritten = 0;

  for (let i = 0; i + 4 < bytes.length; i++) {
    // "/URI"
    if (bytes[i] !== 0x2f || bytes[i + 1] !== 0x55 || bytes[i + 2] !== 0x52 || bytes[i + 3] !== 0x49) continue;

    let j = i + 4;
    while (j < bytes.length && WS.has(bytes[j])) j++;
    if (bytes[j] !== OPEN_PAREN) continue;

    const start = j + 1;
    let end = start;
    while (end < bytes.length && bytes[end] !== CLOSE_PAREN) end++;
    if (end >= bytes.length) break;

    let url = '';
    for (let k = start; k < end; k++) url += String.fromCharCode(bytes[k]);

    const direct = unwrapGoogleRedirect(url);
    if (!direct) {
      i = end;
      continue;
    }

    const escaped = direct.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const available = end - start + 1; // sin contar el paréntesis de apertura
    if (escaped.length + 1 > available) {
      i = end;
      continue;
    }

    for (let k = 0; k < escaped.length; k++) bytes[start + k] = escaped.charCodeAt(k) & 0xff;
    bytes[start + escaped.length] = CLOSE_PAREN;
    for (let k = start + escaped.length + 1; k <= end; k++) bytes[k] = SPACE;

    rewritten++;
    i = end;
  }

  return rewritten;
}
