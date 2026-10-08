# Genera mcp/Instrucciones.pdf (guía para no técnicos). Correr desde mcp/docs: python3 instrucciones.py
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak

OUT = "../Instrucciones.pdf"
INK = colors.HexColor("#1a1a1a"); MUTED = colors.HexColor("#5a5a5a"); ACCENT = colors.HexColor("#2d5a57")
BOX = colors.HexColor("#f0eeeb"); LINE = colors.HexColor("#d9d6d1")

base = ParagraphStyle("base", fontName="Helvetica", fontSize=11.5, leading=17, textColor=INK)
title = ParagraphStyle("title", parent=base, fontName="Helvetica-Bold", fontSize=26, leading=32, spaceAfter=4)
sub = ParagraphStyle("sub", parent=base, fontSize=12.5, leading=18, textColor=MUTED, spaceAfter=14)
h = ParagraphStyle("h", parent=base, fontName="Helvetica-Bold", fontSize=16, leading=21, textColor=ACCENT, spaceBefore=16, spaceAfter=6)
step = ParagraphStyle("step", parent=base, fontName="Helvetica-Bold", fontSize=13, leading=18, spaceBefore=10, spaceAfter=3)
small = ParagraphStyle("small", parent=base, fontSize=10, leading=14, textColor=MUTED)
bullet = ParagraphStyle("bullet", parent=base, leftIndent=14, bulletIndent=2, spaceAfter=3)
code = ParagraphStyle("code", parent=base, fontName="Courier-Bold", fontSize=12, leading=16)

def P(t, s=base): return Paragraph(t, s)
def B(t): return Paragraph(t, bullet, bulletText="•")
def codebox(text, note=None):
    rows = [[P(text, code)]]
    if note: rows.append([P(note, small)])
    t = Table(rows, colWidths=[16.5*cm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),BOX),("BOX",(0,0),(-1,-1),0.75,LINE),
        ("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),12),("TOPPADDING",(0,0),(-1,-1),9),("BOTTOMPADDING",(0,0),(-1,-1),9)]))
    return t
def callout(text):
    t = Table([[P(text)]], colWidths=[16.5*cm])
    t.setStyle(TableStyle([("BOX",(0,0),(-1,-1),0.75,ACCENT),("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),12),("TOPPADDING",(0,0),(-1,-1),9),("BOTTOMPADDING",(0,0),(-1,-1),9)]))
    return t

S = []
S += [P("Instrucciones", title),
      P("Conectar We.Page Eventos con Claude en tu Mac", sub),
      P("Con esto podrás pedirle a Claude, en lenguaje normal, que te diga cuántos registros lleva un evento, que cree un formulario, que etiquete invitados o que mande un correo. Claude entra con tu propia cuenta del panel, así que solo ve los eventos a los que tú tienes acceso."),
      Spacer(1,8),
      callout("<b>Tiempo estimado: 10 minutos.</b> Solo hay que copiar y pegar unas líneas en la aplicación <b>Terminal</b>. No necesitas saber programar."),
      P("Antes de empezar", h),
      B("Una Mac."),
      B("Tu correo y contraseña de <b>panel.we.page</b>. Si no tienes cuenta, pídela al equipo de We.Page."),
      B("<b>Claude Desktop</b> instalado (la aplicación de Claude para Mac) o Claude Code, si lo usas."),
      B("El archivo <b>we-eventos-mcp.zip</b> que te compartieron."),
]
S += [P("Paso 1 · Instala Node", h),
      P("Node es un programa gratuito que necesita esta herramienta para funcionar. Si ya lo tienes, salta al paso 2."),
      B("Entra a <b>nodejs.org</b> en tu navegador."),
      B("Pulsa el botón verde <b>Download Node.js (LTS)</b>."),
      B("Abre el archivo descargado y sigue el instalador con <b>Continuar</b> hasta el final."),
]
S += [P("Paso 2 · Pon la carpeta en su lugar", h),
      B("Haz doble clic en <b>we-eventos-mcp.zip</b>. Aparecerá una carpeta llamada <b>we-eventos-mcp</b>."),
      B("Arrastra esa carpeta a tu carpeta personal (la que tiene el icono de una casita en Finder, con tu nombre de usuario)."),
      B("No la muevas ni la borres después: Claude la usa cada vez que le pides algo."),
]
S += [P("Paso 3 · Abre Terminal", h),
      P("Terminal es una aplicación que ya viene en tu Mac. Es una ventana donde escribes instrucciones."),
      B("Pulsa <b>Cmd + barra espaciadora</b>, escribe <b>Terminal</b> y pulsa Enter."),
      B("Copia la siguiente línea, pégala en Terminal y pulsa Enter:"),
      codebox("cd ~/we-eventos-mcp", "Esto le dice a Terminal que trabaje dentro de la carpeta que acabas de guardar."),
      Spacer(1,6),
      B("Ahora copia esta otra, pégala y pulsa Enter. Tarda alrededor de un minuto y muestra texto; es normal:"),
      codebox("npm install", "Si dice <b>command not found</b>, Node no quedó instalado: repite el paso 1 y cierra y vuelve a abrir Terminal."),
]
S += [P("Paso 4 · Inicia sesión", h),
      B("Copia esta línea, pégala y pulsa Enter:"),
      codebox("node bin.js setup"),
      Spacer(1,6),
      B("Te preguntará cómo quieres entrar. Escribe <b>1</b> y pulsa Enter: se abrirá una página en tu navegador."),
      B("Escribe tu correo y contraseña del panel y pulsa <b>Entrar</b>. Puedes cerrar esa pestaña cuando confirme."),
      B("Vuelve a Terminal. Verás una palomita verde con tu correo. Tu contraseña no se guarda; solo una llave de sesión."),
]
S += [P("Paso 5 · Conéctalo a Claude", h),
      P("La misma pantalla de Terminal te muestra dos formas. Elige la aplicación que usas."),
      P("Si usas Claude Desktop", step),
      B("En Terminal verás un bloque de texto que empieza con una llave <b>{</b> y termina con <b>}</b>. Selecciónalo completo y cópialo."),
      B("Abre Finder, pulsa <b>Cmd + Shift + G</b>, pega esta ruta y pulsa Enter:"),
      codebox("~/Library/Application Support/Claude/"),
      Spacer(1,6),
      B("Busca el archivo <b>claude_desktop_config.json</b>. Ábrelo con la aplicación <b>TextEdit</b> (clic derecho → Abrir con)."),
      B("Si el archivo está vacío o no existe, crea uno nuevo en TextEdit con ese nombre, pega el bloque y guarda. Si ya tiene contenido, pide ayuda al equipo para unirlo; es un minuto."),
      B("Cierra Claude Desktop por completo (Cmd + Q) y vuelve a abrirlo."),
      P("Si usas Claude Code", step),
      B("Terminal te pregunta <b>¿Lo conecto a Claude Code ahora mismo?</b> Escribe <b>s</b> y pulsa Enter. Listo."),
]
S += [P("Paso 6 · Pruébalo", h),
      P("Abre Claude y escribe exactamente esto:"),
      codebox("Usa el MCP we-eventos. Dime qué eventos tengo y cuántos registros lleva cada uno."),
      Spacer(1,6),
      P("Si te responde con tus eventos, quedó listo. La primera vez puede pedirte permiso para usar la herramienta: acepta."),
]
S += [P("Qué puedes pedirle", h),
      B("“Crea el evento <i>Cena de fin de año</i> el 12 de diciembre a las 8 pm en Hacienda X, con formulario de nombre, correo, WhatsApp y acompañantes.”"),
      B("“¿Cuántos registrados de Monterrey no han abierto el correo de invitación?”"),
      B("“Etiqueta como <i>VIP</i> a los que respondieron Patrocinador.”"),
      B("“Mándame una prueba de la plantilla de recordatorio.”"),
      Spacer(1,4),
      P("Antes de publicar un formulario, mandar correos o cambiar muchos registros, Claude te pedirá que confirmes. Nada con consecuencias pasa sin tu visto bueno."),
]
S += [P("Si algo falla", h),
      B("<b>Claude dice que la sesión ya no sirve:</b> abre Terminal y repite el paso 4."),
      B("<b>Cambiaste tu contraseña del panel:</b> repite el paso 4."),
      B("<b>Claude no encuentra la herramienta:</b> cierra Claude por completo (Cmd + Q) y ábrelo de nuevo. Si sigue igual, revisa el paso 5."),
      B("<b>Moviste la carpeta de lugar:</b> repite los pasos 3, 4 y 5."),
      B("<b>Cualquier otra cosa:</b> manda una captura de pantalla de Terminal al equipo de We.Page."),
      Spacer(1,10),
      P("Esto no reemplaza al panel web: eliminar eventos, generar códigos QR, crear invitaciones y exportar el Excel del bot se siguen haciendo en panel.we.page.", small),
]

def footer(c, d):
    c.saveState(); c.setFont("Helvetica", 9); c.setFillColor(MUTED)
    c.drawString(2*cm, 1.3*cm, "We.Page Eventos · Instrucciones para conectar Claude"); c.drawRightString(letter[0]-2*cm, 1.3*cm, str(d.page)); c.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=letter, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm, title="Instrucciones · We.Page Eventos y Claude", author="We.Page")
doc.build(S, onFirstPage=footer, onLaterPages=footer)
print("ok")
