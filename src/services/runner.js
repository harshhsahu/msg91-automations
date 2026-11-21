import fs from 'node:fs';
import path from 'node:path';
import { owner } from './viasocket.js';
import { buildCases } from './catalog.js';
import * as msg91 from './msg91.js';
import { grade } from './grade.js';
import { config } from '../config/env.js';
import { getReceiver, receiverStatus, account } from './receiver.js';

const RUNS = new Map();
const DIR = config.runsDir;
const RECEIVER_URL = run => run.viasocket?.url;
const save = run => fs.writeFileSync(path.join(DIR, `${run.id}.json`), JSON.stringify(run, null, 1));

export function loadRuns() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); if (r.progress) r.progress.running = false; RUNS.set(r.id, r);
  }
}
export const listRuns = () => [...RUNS.values()].map(r => ({ id: r.id, scope: r.scope, running: !!r.progress?.running, env: r.env, mode: r.mode, startedAt: r.startedAt, counts: counts(r) })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
export const getRun = id => RUNS.get(id);
const counts = r => r.cases.reduce((a, c) => (a[c.status] = (a[c.status] || 0) + 1, a), { total: r.cases.length });

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}

export async function startRun({ env, mode, services, events, templates, selection, variableOverrides }) {
  const rs = await receiverStatus();
  if (!rs.ready) throw new Error('viaSocket receiver is not ready: ' + rs.reason + ' Click "Set up receiver" in the panel.');
  const rec = getReceiver();
  const [tRaw, eRaw] = await Promise.all([msg91.getTemplatesRaw(env), msg91.getEventsRaw(env)]);
  const cat = buildCases(tRaw, eRaw);
  const pick = (sel, v) => !sel?.length || sel.includes(v);
  const sel = selection?.length ? new Set(selection) : null;
  const chosen = cat.cases.filter(c => (sel ? sel.has(`${c.event}|${c.templateId}`) : pick(services, c.service) && pick(events, c.event) && pick(templates, c.templateId)));
  if (!chosen.length) throw new Error('No cases matched. Check /api/catalog/raw: the catalog shape may need a tweak in src/catalog.js');
  if ([...RUNS.values()].some(r => r.progress?.running)) throw new Error('A run is already in progress. Wait for it to finish (batches keep MSG91 within its limits).');
  const id = 'R' + Date.now().toString(36);
  const run = { id, env, mode, viasocket: { ...account(), scriptId: rec.scriptId, url: rec.url }, startedAt: new Date().toISOString(), overrides: variableOverrides && typeof variableOverrides === 'object' ? variableOverrides : {}, scope: services?.length === 1 ? services[0] : (selection?.length ? 'custom selection' : 'all services'), progress: { running: true, batch: 0, batches: 0, done: 0, total: chosen.length }, cases: chosen.map((c, n) => ({ ...c, caseId: `${id}-${n + 1}`, status: 'PENDING', issues: [], rows: [] })) };
  RUNS.set(id, run); save(run);
  runBatches(run).catch(e => { run.error = e.message; }).finally(() => { run.executed = true; run.progress.running = false; save(run); });
  return run;
}

// Bulk runs go in batches: MSG91 dry-run cannot take everything in one hit.
async function runBatches(run) {
  const size = Math.max(1, config.batchSize), batches = [];
  for (let i = 0; i < run.cases.length; i += size) batches.push(run.cases.slice(i, i + size));
  run.progress.batches = batches.length;
  for (let b = 0; b < batches.length; b++) {
    run.progress.batch = b + 1; save(run);
    await pool(batches[b], run.mode === 'dry' ? 1 : config.liveConcurrency, async c => { await executeCase(run, c, c.tpl); run.progress.done++; });
    if (b < batches.length - 1) await sleep(run.mode === 'dry' ? config.batchPauseMs : 1000);
  }
}

function failIfRejected(r) {
  if (r && (r.error || r.status === false || r.success === false)) {
    const e = r.error || r;
    const detail = typeof e === 'object' ? JSON.stringify(e, (k, v) => (k === '_errors' && !v.length ? undefined : v)) : e;
    throw new Error('MSG91 rejected the request: ' + (r.message || '') + ' ' + detail.slice(0, 300));
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isRateLimit = e => /too many|rate limit|try again later/i.test(e?.message || '');
async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (!isRateLimit(e) || i >= 6) throw e; await sleep(10000 * (i + 1)); }
  }
}
function rateLimited(r) { return /too many|try again later/i.test(JSON.stringify(r || {})); }

async function executeCase(run, c, tpl) {
  try {
    if (!tpl.format) { c.status = 'ERROR'; c.issues = [{ type: 'no_template_payload', message: 'Template has no payload format; fix extractTemplates()' }]; return; }
    c.sentAt = new Date().toISOString();
    c.webhookName = `${c.caseId} ${c.event}`.slice(0, 50); // MSG91 limit: 50 chars
    const cfg = {
      service: c.service, url: RECEIVER_URL(run), method: tpl.method, webhookName: c.webhookName,
      headers: { ...tpl.headers, 'X-Case-Id': c.caseId }, event: c.event, resPayloadFormat: tpl.format,
      batching: false, rateLimit: 100, maintainOrder: true, paused: false,
      companyId: msg91.envConfig(run.env).companyId || null,
    };
    c.tplFmt = tpl.format; c.expectedMethod = tpl.method; delete c.tpl;
    if (run.mode === 'dry') {
      const vars = await withRetry(() => msg91.dryRunVariables(run.env, { ...cfg, conditions: [] }));
      const base = vars?.data?.variableValues || vars?.variableValues || vars?.data || vars || {};
      c.vars = { ...base, ...(run.overrides || {}), requestId: c.caseId };
      c.dryRunResponse = await withRetry(async () => { const r = await msg91.dryRun(run.env, { ...cfg, conditions: [], variableValues: c.vars }); if (rateLimited(r)) throw new Error('Too many dry-run requests'); return r; });
      const timedOut = r => r?.responseData?.responseBody?.connectionError;
      if (timedOut(c.dryRunResponse)) { // MSG91 waits only 5s for the receiver: retry once
        await sleep(3000);
        c.firstDryRunResponse = c.dryRunResponse;
        c.dryRunResponse = await withRetry(async () => { const r = await msg91.dryRun(run.env, { ...cfg, conditions: [], variableValues: c.vars }); if (rateLimited(r)) throw new Error('Too many dry-run requests'); return r; });
      }
      if (timedOut(c.dryRunResponse)) { // keep waiting: the hit may still reach viaSocket history
        c.status = 'WAITING'; c.note = 'MSG91 dry run timed out after 5s waiting for the receiver. The panel will pick the hit up from viaSocket history if it arrived.';
        save(run); await sleep(config.dryRunDelayMs); return;
      }
      failIfRejected(c.dryRunResponse);
      // MSG91 returns the receiver's answer inline: use it as the snapshot right away.
      const rb = c.dryRunResponse?.responseData?.responseBody;
      if (rb && typeof rb === 'object' && rb.caseId === c.caseId) {
        const g = grade({ tplFmt: c.tplFmt, vars: c.vars, received: rb.body, expectedMethod: c.expectedMethod, receivedMethod: rb.method });
        Object.assign(c, g, { received: rb.body, receivedAt: rb.receivedAt, retryCount: 0, requestId: rb.body?.requestId ?? c.vars.requestId });
        save(run);
        await sleep(config.dryRunDelayMs); // stay under MSG91's dry-run rate limit
        return;
      }
      await sleep(config.dryRunDelayMs);
      c.status = 'WAITING';
    } else {
      c.createResponse = await msg91.createWebhook(run.env, cfg);
      failIfRejected(c.createResponse);
      const cr = c.createResponse; c.webhookId = cr?.webhook?.webhookId || cr?.data?._id || cr?.data?.id || cr?.data?.webhookId || cr?._id || cr?.id || null;
      c.status = 'WAITING'; // a live hit arrives when a real event fires
    }
  } catch (e) {
    c.status = 'ERROR'; c.issues = [{ type: 'api_error', message: e.message }];
  }
  save(run);
}

export async function collect(runId) {
  const run = RUNS.get(runId); if (!run) throw new Error('unknown run');
  const mine = account();
  const vs = run.viasocket || { ...mine, scriptId: getReceiver()?.scriptId };
  if (vs.orgId !== mine.orgId || vs.projectId !== mine.projectId)
    throw new Error(`This run was made on viaSocket ${vs.orgId}/${vs.projectId}; the panel is now connected to ${mine.orgId}/${mine.projectId}, so its hits can't be read. Switch the viaSocket values in .env back to view it.`);
  const scriptId = vs.scriptId;
  const hits = new Map();
  for (let page = 1; page <= 5; page++) {
    const h = await owner.runHistory(scriptId, { page, limit: 100 });
    if (!h?.length) break;
    for (const r of h) {
      let out; try { out = JSON.parse(r.output); } catch { continue; }
      if (out?.caseId) { const h0 = hits.get(out.caseId); if (h0) h0.count++; else hits.set(out.caseId, { ...out, at: r.requestTimestamp, count: 1 }); }
    }
    if (h.length < 100) break;
  }
  for (const c of run.cases) { // re-grade stored snapshots with the current rules
    if (c.received != null && c.tplFmt) Object.assign(c, grade({ tplFmt: c.tplFmt, vars: c.vars || null, received: c.received, expectedMethod: c.expectedMethod, receivedMethod: null }));
  }
  const waitMs = run.mode === 'dry' ? config.dryRunWaitMs : null;
  for (const c of run.cases) {
    if (c.status !== 'WAITING' && c.status !== 'NO_HIT') continue;
    const hit = hits.get(c.caseId);
    if (hit) {
      const g = grade({ tplFmt: c.tplFmt, vars: c.vars || null, received: hit.body, expectedMethod: c.expectedMethod, receivedMethod: hit.method });
      Object.assign(c, g, { received: hit.body, receivedAt: hit.at, retryCount: hit.count - 1, requestId: hit.body?.requestId ?? c.vars?.requestId ?? null });
    } else if (waitMs && Date.now() - new Date(c.sentAt || run.startedAt) > waitMs && !run.progress?.running) {
      c.status = 'FAIL'; c.issues = [{ type: 'no_hit', message: 'No hit received within 3 minutes' }];
    }
  }
  save(run); return run;
}
