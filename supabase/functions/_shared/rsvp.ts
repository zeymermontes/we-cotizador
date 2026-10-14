// Enlace de confirmación de un VIP (registro.we.page/<slug>/c/<token>).
// Este módulo también lo importa el navegador (vía messaging-core), por eso
// no toca Deno directamente.
// deno-lint-ignore no-explicit-any
const env = (globalThis as any).Deno?.env?.get?.('REGISTRO_BASE_URL') as string | undefined;
export const REGISTRO_BASE_URL = (env ?? 'https://registro.we.page').replace(/\/$/, '');
export const confirmUrl = (slug: string, token: string | null | undefined) => (token ? `${REGISTRO_BASE_URL}/${slug}/c/${token}` : '');
