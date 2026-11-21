// The viaSocket "receiver" flow: the webhook address every MSG91 test webhook points at.
// It is stored PER viaSocket account (orgId:projectId) in data/receiver.json, so swapping the viaSocket
// credentials in .env never leaves the panel pointing at a flow the new account can't read.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { owner } from './viasocket.js';

const FILE = path.resolve('data/receiver.json');
const accountKey = () => `${config.viasocket.orgId}:${config.viasocket.projectId}`;
const readAll = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const writeAll = d => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 1)); };

export const account = () => ({ orgId: config.viasocket.orgId, projectId: config.viasocket.projectId });
export const getReceiver = () => readAll()[accountKey()] || null;

export async function receiverStatus() {
  const base = { account: account(), configured: Boolean(config.viasocket.orgId && config.viasocket.projectId && config.viasocket.secret) };
  if (!base.configured) return { ...base, ready: false, reason: 'viaSocket credentials are missing in .env (VIASOCKET_ORG_ID, _PROJECT_ID, _EMBED_SECRET).' };
  const r = getReceiver();
  if (!r) return { ...base, ready: false, reason: 'No receiver exists for this viaSocket account yet.' };
  try {
    const flow = await owner.readFlow(r.scriptId);
    if (!flow?.steps?.length) throw new Error('flow has no steps');
    return { ...base, ready: true, scriptId: r.scriptId };
  } catch (e) {
    return { ...base, ready: false, reason: `Receiver ${r.scriptId} is not usable in this account (${e.message}).` };
  }
}

export async function ensureReceiver() {
  const st = await receiverStatus();
  if (st.ready) return { ...st, created: false };
  if (!st.configured) throw new Error(st.reason);
  const { scriptId } = await owner.createFlow({ title: 'MSG91 webhook test receiver', description: 'Receives MSG91 webhook hits for the test panel' });
  const trig = await owner.setTrigger(scriptId, { triggerType: 'webhook' });
  await owner.saveSteps(scriptId, [{
    stepname: 'capture', serviceActionFunctions: [],
    code: `return { caseId: context?.req?.headers?.['x-case-id'] || context?.req?.query?.case || null, method: context?.req?.method || null, headers: context?.req?.headers || {}, query: context?.req?.query || {}, body: context?.req?.body ?? null, receivedAt: new Date().toISOString() }`,
  }]);
  const all = readAll(); all[accountKey()] = { scriptId, url: trig.webhookUrl, createdAt: new Date().toISOString() }; writeAll(all);
  return { account: account(), configured: true, ready: true, scriptId, created: true };
}
