// `node bin.js setup` — inicia sesión (navegador o terminal), guarda el
// refresh token y te da el comando para conectar el MCP a Claude.
import { createClient } from '@supabase/supabase-js';
import { createServer } from 'node:http';
import { exec, execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { saveCredentials, loadCredentials, clearCredentials, CREDENTIALS_FILE } from './credentials.ts';
import { projectConfig } from './client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(join(HERE, '..', 'bin.js'));
const PORT = 4879;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

// Una sola interfaz de readline para toda la sesión, con cola de líneas:
// así funciona igual en una terminal real que con la entrada por tubería.
let rl: ReturnType<typeof createInterface> | null = null;
let muted = false;
const lineQueue: string[] = [];
let pending: ((line: string) => void) | null = null;
function getRl() {
  if (rl) return rl;
  rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  // deno-lint-ignore no-explicit-any
  const anyRl = rl as any;
  const original = anyRl._writeToOutput?.bind(rl);
  if (original) anyRl._writeToOutput = (s: string) => { if (!muted) original(s); };
  rl.on('line', line => { if (pending) { const p = pending; pending = null; p(line); } else lineQueue.push(line); });
  return rl;
}
function ask(question: string, mask = false): Promise<string> {
  return new Promise(resolvePrompt => {
    getRl();
    process.stdout.write(question);
    muted = mask && !!process.stdin.isTTY;
    const done = (line: string) => { if (muted) { muted = false; process.stdout.write('\n'); } resolvePrompt(line.trim()); };
    const queued = lineQueue.shift();
    if (queued !== undefined) done(queued); else pending = done;
  });
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function loginPage(url: string, anon: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>We.Page · MCP</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f0eeeb;font-family:-apple-system,Inter,sans-serif;color:#1a1a1a}
.card{background:#fff;border-radius:20px;padding:36px 32px;width:360px;box-shadow:0 12px 40px rgba(0,0,0,.1);text-align:center}
h1{font-family:Georgia,serif;font-weight:500;font-size:1.4rem;margin:0 0 4px}p{color:#6b6b6b;font-size:14px;margin:0 0 18px}
input{width:100%;box-sizing:border-box;padding:12px 0;border:none;border-bottom:2px solid #ddd;font-size:16px;outline:none;margin-bottom:12px;background:transparent}
input:focus{border-bottom-color:#8fd6d1}
button{width:100%;padding:12px;border:none;border-radius:999px;background:#BBEBE8;font-size:15px;font-weight:600;cursor:pointer;margin-top:6px}
.ghost{background:transparent;color:#6b6b6b;font-weight:500}.msg{font-size:13px;margin-top:12px;min-height:18px}.err{color:#b91c1c}.ok{color:#047857}
</style></head><body><div class="card">
<h1>Conectar el MCP</h1><p>Entra con tu usuario del admin de We.Page</p>
<form id="f"><input id="email" type="email" placeholder="correo" required autofocus><input id="pass" type="password" placeholder="contraseña">
<button type="submit">Entrar →</button></form>
<div class="msg" id="msg"></div></div>
<script type="module">
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const sb = createClient(${JSON.stringify(url)}, ${JSON.stringify(anon)});
const msg = document.getElementById('msg');
async function hand(session){
  msg.className='msg';msg.textContent='Guardando sesión…';
  const r = await fetch('/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token,email:session.user.email})});
  if(r.ok){msg.className='msg ok';msg.textContent='✓ Listo. Ya puedes cerrar esta pestaña y volver a la terminal.';document.getElementById('f').style.display='none';}
  else{msg.className='msg err';msg.textContent='La terminal no respondió. ¿Sigue corriendo el setup?';}
}
const { data:{ session } } = await sb.auth.getSession();
if(session) hand(session);
sb.auth.onAuthStateChange((e,s)=>{ if(e==='SIGNED_IN'&&s) hand(s); });
document.getElementById('f').onsubmit=async ev=>{ev.preventDefault();msg.className='msg';msg.textContent='Entrando…';
  const {error}=await sb.auth.signInWithPassword({email:email.value,password:pass.value});
  if(error){msg.className='msg err';msg.textContent=error.message;}};
</script></body></html>`;
}

async function loginInBrowser(url: string, anon: string): Promise<{ refresh_token: string; email: string }> {
  return new Promise((resolveLogin, reject) => {
    const server = createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPage(url, anon));
        return;
      }
      if (req.method === 'POST' && req.url === '/callback') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { refresh_token, email } = JSON.parse(body);
            if (!refresh_token) throw new Error('sin token');
            res.writeHead(200); res.end('ok');
            server.close();
            resolveLogin({ refresh_token, email: email ?? '' });
          } catch (e) { res.writeHead(400); res.end('bad'); reject(e); }
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(PORT, '127.0.0.1', () => {
      const link = `http://localhost:${PORT}/`;
      console.log(`\nAbriendo ${bold(link)} en tu navegador…`);
      openBrowser(link);
    });
    server.on('error', reject);
  });
}

async function loginInTerminal(url: string, anon: string): Promise<{ refresh_token: string; email: string }> {
  const email = await ask('Correo: ');
  const password = await ask('Contraseña: ', true);
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? 'No se pudo iniciar sesión');
  return { refresh_token: data.session.refresh_token, email: data.user?.email ?? email };
}

async function main() {
  console.log(`\n${bold('We.Page Eventos · MCP')}\n`);
  const { url, anon } = projectConfig();

  const existing = loadCredentials();
  if (existing) {
    console.log(`Ya hay una sesión guardada de ${bold(existing.email)} (${dim(CREDENTIALS_FILE)}).`);
    const again = await ask('¿Iniciar sesión de nuevo? (s/N): ');
    if (!/^s/i.test(again)) { printConnect(existing.email); return; }
    clearCredentials();
  }

  console.log('¿Cómo quieres iniciar sesión?');
  console.log('  1) En el navegador (abre una pestaña; correo y contraseña)');
  console.log('  2) Aquí en la terminal (correo y contraseña)');
  const choice = await ask('Opción [1]: ');
  const creds = choice.trim() === '2' ? await loginInTerminal(url, anon) : await loginInBrowser(url, anon);

  saveCredentials({ url, anon_key: anon, refresh_token: creds.refresh_token, email: creds.email, saved_at: new Date().toISOString() });

  // Verifica y muestra el rol
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.refreshSession({ refresh_token: creds.refresh_token });
  if (error || !data.session || !data.user) throw new Error(error?.message ?? 'La sesión no sirve');
  saveCredentials({ url, anon_key: anon, refresh_token: data.session.refresh_token, email: creds.email, saved_at: new Date().toISOString() });
  const { data: p } = await sb.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  console.log(`\n${green('✓')} Sesión guardada para ${bold(creds.email)} · rol: ${bold(p?.role ?? 'event_admin')}`);
  console.log(dim(`  (${CREDENTIALS_FILE}; solo el refresh token, nunca la contraseña)`));

  await printConnect(creds.email, true);
}

async function printConnect(email: string, offer = false) {
  const cmd = `claude mcp add --scope user we-eventos -- node "${BIN}"`;
  console.log(`\n${bold('Claude Code')} — corre esto una vez:\n\n  ${cmd}\n`);
  console.log(`${bold('Claude Desktop')} — agrega esto a ${dim('~/Library/Application Support/Claude/claude_desktop_config.json')}:\n`);
  console.log(JSON.stringify({ mcpServers: { 'we-eventos': { command: 'node', args: [BIN] } } }, null, 2).split('\n').map(l => '  ' + l).join('\n'));
  console.log(`\n${bold('Prompt para empezar')} (pégalo en Claude):\n`);
  console.log(`  Usa el MCP we-eventos. Dime qué eventos tengo y cuántos registros lleva cada uno.\n`);

  if (offer) {
    const hasClaude = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude']).status === 0;
    if (hasClaude) {
      const run = await ask('¿Lo conecto a Claude Code ahora mismo? (S/n): ');
      if (!/^n/i.test(run)) {
        try {
          execSync(`claude mcp remove we-eventos -s user`, { stdio: 'ignore' });
          execSync(`claude mcp remove we-eventos -s local`, { stdio: 'ignore' });
        } catch { /* no existía */ }
        try {
          execSync(cmd, { stdio: 'inherit' });
          console.log(`\n${green('✓')} Conectado como ${email}. Abre Claude Code y escribe /mcp para verlo.`);
        } catch {
          console.log(yellow('No se pudo ejecutar automáticamente; corre el comando de arriba a mano.'));
        }
      }
    } else {
      console.log(dim('No encontré el comando `claude` en el PATH; corre el comando de arriba cuando lo tengas.'));
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(`\n${yellow('Error:')} ${(e as Error).message}`); process.exit(1); });
