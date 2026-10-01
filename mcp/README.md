# we-eventos-mcp

Servidor MCP local para que una IA (Claude Code, Claude Desktop, Cursor…) lea, cree y
modifique eventos de registro de We.Page: eventos, formularios con lógica condicional,
registros, plantillas de correo, automatizaciones y asistencia.

Corre en tu máquina por stdio y entra a Supabase **como tú**: RLS decide qué eventos ves.
Las acciones con consecuencias (publicar, enviar correos, cambios masivos) piden
`confirm: true`. Todo queda en la tabla `mcp_audit` (migración 014).

## Instalación (una vez)

```bash
cd cotizador-app/mcp
npm install
node bin.js setup
```

`setup` te pregunta cómo iniciar sesión:

1. **En el navegador**: abre una pestaña en `http://localhost:4879` donde entras con tu
   contraseña o pides un enlace mágico. Para el enlace mágico, esa URL debe estar en
   Supabase → Authentication → URL Configuration → Redirect URLs (`http://localhost:4879/**`).
2. **En la terminal**: correo y contraseña (no se muestra al escribir).

Solo se guarda el **refresh token** en `~/.we-eventos-mcp/credentials.json` (permisos 600),
nunca la contraseña. Al terminar te imprime el comando de Claude Code y ofrece ejecutarlo,
el bloque para Claude Desktop y un prompt para empezar. Para cambiar de usuario, vuelve a
correr `node bin.js setup`.

Alternativa sin setup: credenciales fijas en `mcp/.env` (ver `.env.example`).

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `whoami` | Usuario y rol con el que está conectado |
| `describe_form_schema` | Guía del JSON de formularios (léela antes de crear uno) |
| `list_events`, `get_event` | Eventos con conteos, detalle, enlaces públicos y estado del formulario |
| `create_event` (super), `update_event` | Crear y modificar; cambiar estatus requiere `confirm` |
| `get_form`, `update_form_draft`, `publish_form` | Ver, guardar borrador validado, publicar (`confirm`) |
| `list_registrations`, `get_registration` | Buscar y filtrar por cualquier pregunta; detalle con respuestas y mensajes |
| `update_registrations`, `create_registration` | Estatus, etiquetas, notas (más de 20 requiere `confirm`); alta manual |
| `list_templates`, `upsert_template`, `set_automation` | Plantillas de correo y automatizaciones |
| `send_template` | Enviar plantilla a registros (`confirm`) o prueba con `test_to` |
| `list_messages` | Historial con estados de Resend |
| `get_attendance` | Check-ins del scanner, totales y llegadas por hora |

Ejemplos de lo que puedes pedirle a la IA:

- "Crea el evento *Cena de fin de año* para el 12 de diciembre a las 8 pm en Hacienda X, bilingüe, con formulario de nombre, correo, WhatsApp, acompañantes y si es alérgico a algo (solo si trae acompañante preguntar cuántos)."
- "¿Cuántos confirmados de Monterrey no han abierto el correo de invitación?"
- "Etiqueta como *VIP* a todos los que respondieron 'Patrocinador' en la pregunta de perfil."
- "Mándame una prueba de la plantilla de recordatorio."

## Fuera del alcance (por ahora)

Eliminar eventos, generar QR, invitaciones en Slides y Excel para el bot se hacen desde el admin.
