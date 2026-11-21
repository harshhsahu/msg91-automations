import { config } from './config/env.js';
import express from 'express';
import * as msg91 from './services/msg91.js';
import { buildCases } from './services/catalog.js';
import { receiverStatus, ensureReceiver } from './services/receiver.js';
import { runToXlsx } from './services/xlsx.js';
import { startRun, getRun, listRuns, collect, loadRuns } from './services/runner.js';

loadRuns();
const app = express();
app.use(express.json());
app.use(express.static('public'));
const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(500).json({ error: e.message }));

app.get('/api/viasocket/status', wrap(async (_, res) => res.json(await receiverStatus())));
app.post('/api/viasocket/receiver', wrap(async (_, res) => res.json(await ensureReceiver())));
app.get('/api/envs', (_, res) => res.json(msg91.envStatus()));
app.get('/api/:env/catalog', wrap(async (req, res) => {
  const [t, e] = await Promise.all([msg91.getTemplatesRaw(req.params.env), msg91.getEventsRaw(req.params.env)]);
  const c = buildCases(t, e);
  res.json({ templates: [{ id: 'default', name: 'Default payload' }, ...[...new Map(c.templates.map(t => [t.id, { id: t.id, name: t.name }])).values()]], events: c.events.map(({ defaultFormat, allowedFields, ...e }) => e), caseCount: c.cases.length, orphanTemplates: c.orphans });
}));
app.get('/api/:env/cases', wrap(async (req, res) => {
  const [t, e] = await Promise.all([msg91.getTemplatesRaw(req.params.env), msg91.getEventsRaw(req.params.env)]);
  const c = buildCases(t, e);
  res.json({ cases: c.cases.map(({ tpl, ...x }) => x), orphans: c.orphans });
}));
app.get('/api/:env/catalog/raw', wrap(async (req, res) => {
  res.json({ templates: await msg91.getTemplatesRaw(req.params.env), events: await msg91.getEventsRaw(req.params.env) });
}));
app.post('/api/runs', wrap(async (req, res) => {
  const { env, mode } = req.body;
  if (!msg91.ENVS.includes(env)) throw new Error('bad env');
  if (env === 'prod' && req.body.confirmProd !== true) throw new Error('Prod runs need confirmation');
  res.json(await startRun({ ...req.body, mode: mode === 'dry' ? 'dry' : 'live' }));
}));
app.get('/api/runs', (_, res) => res.json(listRuns()));
app.get('/api/runs/:id', (req, res) => { const r = getRun(req.params.id); r ? res.json(r) : res.status(404).json({ error: 'not found' }); });
app.get('/api/runs/:id/export.xlsx', wrap(async (req, res) => {
  let r = getRun(req.params.id); if (!r) return res.status(404).json({ error: 'not found' });
  try { r = await collect(r.id); } catch { /* export what we have */ }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${r.id}.xlsx"`);
  res.send(Buffer.from(await runToXlsx(r)));
}));
app.post('/api/runs/:id/collect', wrap(async (req, res) => res.json(await collect(req.params.id))));

app.listen(config.port, () => console.log('Panel on http://localhost:' + (config.port)));
