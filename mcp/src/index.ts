#!/usr/bin/env node
// Servidor MCP local de We.Page Eventos (transporte stdio).
// Configuración: ver mcp/README.md
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.ts';

const server = new McpServer({ name: 'we-eventos', version: '0.1.0' }, {
  instructions: [
    'Herramientas para leer, crear y modificar eventos de registro de We.Page (formularios, registros, correos, asistencia).',
    'Actúas como el usuario conectado: solo ves sus eventos. Las acciones con consecuencias (publicar, enviar correos, cambios masivos) requieren confirm: true; pide confirmación a la persona antes de pasarlo.',
    'Antes de crear o modificar un formulario, llama describe_form_schema. Para editar uno existente, usa get_form con full: true, modifica el JSON y mándalo completo a update_form_draft.',
    'Identifica eventos por slug o id; si no lo sabes, usa list_events.',
  ].join(' '),
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
