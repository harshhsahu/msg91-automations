import '../config/env.js';

export const ENVS = ['test', 'stage', 'prod'];

export function envConfig(env) {
  const k = env.toUpperCase();
  const c = {
    env,
    baseUrl: (process.env[`MSG91_${k}_BASE_URL`] || '').replace(/\/$/, ''),
    companyId: process.env[`MSG91_${k}_COMPANY_ID`] || '',
    authKey: process.env[`MSG91_${k}_AUTH_KEY`] || '',
  };
  c.ready = Boolean(c.baseUrl && c.authKey);
  return c;
}

export function envStatus() {
  return ENVS.map(e => { const c = envConfig(e); return { env: e, baseUrl: c.baseUrl, companyId: c.companyId, ready: c.ready }; });
}

async function call(env, method, path, { query, body } = {}) {
  const c = envConfig(env);
  if (!c.ready) throw new Error(`Environment "${env}" is not configured: set MSG91_${env.toUpperCase()}_BASE_URL and MSG91_${env.toUpperCase()}_AUTH_KEY in .env`);
  const qs = query ? '?' + new URLSearchParams(query) : '';
  const res = await fetch(`${c.baseUrl}/api/v5/report${path}${qs}`, {
    method,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      authkey: c.authKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (res.status === 401 || res.status === 403) throw new Error(`MSG91 ${env}: auth key rejected (HTTP ${res.status}). Check MSG91_${env.toUpperCase()}_AUTH_KEY in .env`);
  if (!res.ok) throw new Error(`MSG91 ${env} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return json;
}

export const getTemplatesRaw = env => call(env, 'GET', '/webhook-templates');
export const getEventsRaw = env => call(env, 'GET', '/webhooks/configuration-options');

export const createWebhook = (env, body) =>
  call(env, 'POST', '/webhooks', { query: { companyId: envConfig(env).companyId || 'null' }, body });
export const dryRunVariables = (env, body) =>
  call(env, 'POST', '/webhooks/dry-run/variables', { query: { companyId: envConfig(env).companyId }, body });
export const dryRun = (env, body) =>
  call(env, 'POST', '/webhooks/dry-run', { query: { companyId: envConfig(env).companyId }, body });
