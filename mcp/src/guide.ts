// Referencia del esquema del formulario, para que la IA construya
// formularios válidos sin adivinar el formato.
export const FORM_SCHEMA_GUIDE = `
# Esquema del formulario de registro (JSON)

{ "v": 1, "questions": Question[], "settings": Settings }

## Question
{
  "id": "q_xxxxxxxx",            // único; se genera si falta
  "type": "short_text" | "long_text" | "email" | "phone" | "number" | "single_choice" | "multiple_choice"
        | "dropdown" | "yes_no" | "date" | "rating" | "legal" | "statement" | "hidden",
  "title": { "es": "…", "en": "…" },           // obligatorio en cada idioma del evento (salvo hidden)
  "description": { "es": "…", "en": "…" },     // opcional
  "required": true,
  "image": null,
  "options": [ { "id": "o_xxxxxxxx", "label": { "es": "…", "en": "…" }, "score": 0, "showIf": null } ],  // single_choice / multiple_choice / dropdown; showIf oculta la opción
  "allowOther": false,
  "maxSelections": null,                        // multiple_choice
  "placeholder": { "es": "…" },
  "min": null, "max": null,                     // number
  "ratingSteps": 5, "ratingIcon": "star" | "heart" | "number",
  "buttonLabel": { "es": "Continuar" },         // statement
  "key": "utm_source",                          // parámetro de la URL que la prellena (obligatorio en hidden)
  "skipIfPrefilled": false,                     // si llegó prellenada por URL, no se muestra
  "section": "Datos",                           // bloque (solo organiza la vista de flujo)
  "score": 0,                                   // yes_no: puntos si responde Sí
  "identity": "name" | "email" | "phone" | "party_size" | "company" | null,  // promueve la respuesta a columna; una pregunta por identidad
  "showIf": { "match": "all" | "any", "conditions": Condition[] } | null,     // solo se muestra si se cumple
  "logic": [ { "id": "r_x", "match": "all" | "any", "conditions": ConditionNode[], "jumpTo": "<questionId>" | "end" | "end:<endingId>" } ]
}

## Condition (ConditionNode = Condition | grupo anidado { "match", "conditions": ConditionNode[] })
{ "questionId": "<id de una pregunta ANTERIOR, o $lang | $score | $today>", "op": …, "value": … }
- Operadores: eq, neq, contains, not_contains, gt, lt, gte, lte, between ([min,max]), empty, not_empty,
  count_eq / count_gte / count_lte (cuántas opciones eligió en multiple_choice), before / after (fechas; value "YYYY-MM-DD" o "$today"),
  age_gte / age_lte (edad en años calculada desde una pregunta date).
- Para opciones, value es el id de la opción. Para yes_no / legal, true o false. Para number/rating, un número.
- $lang vale "es" o "en"; $score es la suma de "score" de las opciones elegidas; $today es la fecha de hoy.
- Grupos anidados permiten (A y B) o C: { "match": "any", "conditions": [ { "match": "all", "conditions": [A, B] }, C ] }.
- Los saltos (logic) solo pueden ir a preguntas POSTERIORES, a "end" o a un final alternativo "end:<id>".

## Settings
{ "showProgress": true, "showStepCounter": true, "keyboardShortcuts": true,
  "duplicates": "allow" | "block_email" | "block_phone" | "block_both", "submitLabel": { "es": "Enviar" },
  "ending": { "title": { "es": "¡Listo, {{nombre}}!" }, "subtitle": { "es": "…" } },   // pantalla final por defecto (vacío = estándar)
  "endings": [ { "id": "vip", "name": "VIP", "title": { "es": "…" }, "subtitle": { "es": "…" } } ] }   // finales alternativos para "end:<id>"

## Linter
update_form_draft rechaza errores (referencias rotas, condiciones imposibles, saltos hacia atrás, opciones repetidas,
identidades duplicadas…) y devuelve avisos (preguntas inalcanzables, títulos duplicados, correo sin identidad…). Corrige los avisos cuando tenga sentido.

## Buenas prácticas
- Primera pregunta: nombre completo (short_text, identity "name"). Luego correo (identity "email") y/o WhatsApp (phone, identity "phone").
- Si hay acompañantes: number o single_choice con identity "party_size".
- Una pregunta por pantalla, títulos cortos en forma de pregunta, opciones de 2 a 6.
- Si el evento es bilingüe, TODOS los títulos y opciones llevan "es" y "en".
- Termina con "legal" (aviso de privacidad) si se van a enviar mensajes.
`;
