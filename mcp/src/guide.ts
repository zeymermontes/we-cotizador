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
  "options": [ { "id": "o_xxxxxxxx", "label": { "es": "…", "en": "…" } } ],  // single_choice / multiple_choice / dropdown
  "allowOther": false,
  "maxSelections": null,                        // multiple_choice
  "placeholder": { "es": "…" },
  "min": null, "max": null,                     // number
  "ratingSteps": 5, "ratingIcon": "star" | "heart" | "number",
  "buttonLabel": { "es": "Continuar" },         // statement
  "key": "utm_source",                          // hidden: parámetro de la URL
  "identity": "name" | "email" | "phone" | "party_size" | "company" | null,  // promueve la respuesta a columna; una pregunta por identidad
  "showIf": { "match": "all" | "any", "conditions": Condition[] } | null,     // solo se muestra si se cumple
  "logic": [ { "id": "r_x", "match": "all" | "any", "conditions": Condition[], "jumpTo": "<questionId>" | "end" } ]
}

## Condition
{ "questionId": "<id de una pregunta ANTERIOR>", "op": "eq" | "neq" | "contains" | "not_contains" | "gt" | "lt" | "gte" | "lte" | "empty" | "not_empty", "value": … }
- Para opciones, value es el id de la opción. Para yes_no / legal, true o false. Para number/rating, un número.
- Los saltos (logic) solo pueden ir a preguntas POSTERIORES o a "end".

## Settings
{ "showProgress": true, "showStepCounter": true, "keyboardShortcuts": true,
  "duplicates": "allow" | "block_email" | "block_phone" | "block_both", "submitLabel": { "es": "Enviar" } }

## Buenas prácticas
- Primera pregunta: nombre completo (short_text, identity "name"). Luego correo (identity "email") y/o WhatsApp (phone, identity "phone").
- Si hay acompañantes: number o single_choice con identity "party_size".
- Una pregunta por pantalla, títulos cortos en forma de pregunta, opciones de 2 a 6.
- Si el evento es bilingüe, TODOS los títulos y opciones llevan "es" y "en".
- Termina con "legal" (aviso de privacidad) si se van a enviar mensajes.
`;
