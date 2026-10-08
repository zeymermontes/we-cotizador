# We.Page Eventos · MCP para Mac

Con esto, Claude (Desktop o Claude Code) puede ver y manejar tus eventos de
registro de We.Page: crear eventos y formularios, revisar registros, mandar
correos y consultar asistencia. Entra con **tu** cuenta del panel, así que
solo ves los eventos a los que tienes acceso.

## Necesitas

- Una Mac con **Node.js 20 o más nuevo**. Revisa en Terminal con `node -v`.
  Si no lo tienes, instálalo desde https://nodejs.org (botón "LTS") o con
  Homebrew: `brew install node`.
- Tu correo y contraseña de https://panel.we.page. Si no tienes cuenta,
  pídela al equipo de We.Page.
- Claude Desktop o Claude Code instalado.

## Instalación (5 minutos)

1. Descomprime el zip. Queda una carpeta `we-eventos-mcp`. Muévela a un
   lugar fijo, por ejemplo tu carpeta personal (`~/we-eventos-mcp`). No la
   borres después: Claude la usa cada vez.
2. Abre **Terminal** y entra a la carpeta:

   ```bash
   cd ~/we-eventos-mcp
   ```

3. Instala las dependencias (una sola vez, tarda un minuto):

   ```bash
   npm install
   ```

4. Inicia sesión:

   ```bash
   node bin.js setup
   ```

   Elige la opción 1 para entrar desde el navegador o la 2 para escribir
   correo y contraseña en la terminal. Solo se guarda un token de sesión en
   `~/.we-eventos-mcp/credentials.json`, nunca tu contraseña.

5. Al terminar, el mismo comando te muestra cómo conectarlo:

   - **Claude Code**: te ofrece conectarlo solo. Di que sí, o corre el comando
     que te imprime.
   - **Claude Desktop**: copia el bloque JSON que te imprime y pégalo en
     `~/Library/Application Support/Claude/claude_desktop_config.json`
     (si el archivo no existe, créalo con ese contenido). Reinicia Claude
     Desktop. En Finder: Cmd+Shift+G y pega la ruta para llegar a la carpeta.

## Primer uso

Abre Claude y escribe:

> Usa el MCP we-eventos. Dime qué eventos tengo y cuántos registros lleva cada uno.

Si responde con tus eventos, quedó listo. Otros ejemplos:

- "Crea el evento *Cena de fin de año* el 12 de diciembre a las 8 pm en
  Hacienda X, con formulario de nombre, correo, WhatsApp y acompañantes."
- "¿Cuántos registrados de Monterrey no han abierto el correo de invitación?"
- "Etiqueta como *VIP* a los que respondieron 'Patrocinador'."
- "Mándame una prueba de la plantilla de recordatorio."

Las acciones con consecuencias (publicar un formulario, enviar correos,
cambios a muchos registros) te piden confirmación antes de ejecutarse.

## Si algo falla

- **"La sesión guardada ya no sirve"**: corre `node bin.js setup` de nuevo.
- **Cambiaste de contraseña o de cuenta**: `node bin.js setup` y elige
  iniciar sesión de nuevo.
- **Claude no ve el MCP**: en Claude Code escribe `/mcp` y revisa que
  aparezca `we-eventos`. En Claude Desktop, revisa que el JSON esté bien
  formado y reinicia la app.
- **`npm: command not found`**: falta Node.js; instálalo y vuelve a abrir
  Terminal.
- **Moviste la carpeta**: vuelve a correr `node bin.js setup` para que
  Claude apunte a la ruta nueva.
- **Nada funciona**: borra `~/.we-eventos-mcp/credentials.json` y repite
  desde el paso 4.

## Qué no hace (por ahora)

Eliminar eventos, generar QR, crear invitaciones y exportar el Excel del bot
se hacen desde el panel web.
