#!/usr/bin/env node
// Lanzador: `node bin.js` corre el servidor MCP; `node bin.js setup` inicia sesión y te da el comando.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const sub = process.argv[2];
const entry = sub === 'setup' || sub === 'login' ? 'src/setup.ts' : 'src/index.ts';
const child = spawn(process.execPath, [join(here, 'node_modules/tsx/dist/cli.mjs'), join(here, entry)], { stdio: 'inherit', env: process.env });
child.on('exit', code => process.exit(code ?? 0));
