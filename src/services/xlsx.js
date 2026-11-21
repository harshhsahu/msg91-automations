import ExcelJS from 'exceljs';

const compact = v => { const t = v == null ? '' : JSON.stringify(v); return t.length > 32000 ? t.slice(0, 32000) + '…(truncated)' : t; };
const cap = v => { const t = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2); return t.length > 32000 ? t.slice(0, 32000) + '\n…(truncated)' : t; };
const COLORS = { PASS: 'FF12805C', FAIL: 'FFC4321C', ERROR: 'FFC4321C', WAITING: 'FFB26A00' };

function noSnapshot(run, c) {
  if (c.note) return '(no data) ' + c.note;
  if (c.status === 'ERROR') return '(no data) The request failed before any hit was sent: ' + (c.issues?.[0]?.message || '').slice(0, 300);
  if (run.mode === 'live') return '(no data yet) Live webhook created; it receives data only when a real event fires in MSG91.';
  return '(no data) No hit was received.';
}

export async function runToXlsx(run) {
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet('Summary');
  const counts = run.cases.reduce((a, c) => (a[c.status] = (a[c.status] || 0) + 1, a), {});
  sum.addRows([['Run', run.id], ['viaSocket org', run.viasocket?.orgId || ''], ['Environment', run.env], ['Mode', run.mode], ['Started', run.startedAt], ['Total cases', run.cases.length],
    ...Object.entries(counts).map(([k, v]) => [k, v])]);
  sum.getColumn(1).font = { bold: true }; sum.getColumn(1).width = 18; sum.getColumn(2).width = 40;

  const ws = wb.addWorksheet('Results');
  ws.columns = [
    ['Date', 22], ['Request Id', 30], ['Webhook Id', 24], ['Webhook Name', 40], ['Service', 10], ['Event', 36], ['Template', 20],
    ['Status', 10], ['Error Type', 24], ['Failure Reason', 50], ['Retry Count', 12], ['Raw API Responses', 60], ['Snapshot (webhook data received)', 60], ['Expected Format', 50],
  ].map(([header, width]) => ({ header, width }));
  for (const c of run.cases) {
    const r = ws.addRow([c.receivedAt || '', c.requestId || c.vars?.requestId || c.caseId, c.webhookId || '', c.webhookName || '', c.service, c.eventName ? `${c.eventName} (${c.event})` : c.event, c.templateName,
      c.status, [...new Set((c.issues || []).map(i => i.type))].join(', '), [...(c.issues || []).map(i => i.message), ...(c.note ? [c.note] : [])].join('\n'), c.retryCount ?? '',
      cap({ sent: c.vars, dryRunResponse: c.dryRunResponse, createResponse: c.createResponse }), c.received != null ? compact(c.received) : noSnapshot(run, c), cap(c.tplFmt)]);
    r.getCell(8).font = { bold: true, color: { argb: COLORS[c.status] || 'FF000000' } };
    r.alignment = { vertical: 'top', wrapText: true };
    [12, 13, 14].forEach(i => { r.getCell(i).alignment = { vertical: 'top', wrapText: false }; });
  }
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: 'N1' };

  // One row per problem, for every case that did not pass.
  const es = wb.addWorksheet('Errors');
  es.columns = [['Service', 10], ['Event', 36], ['Template', 20], ['Status', 10], ['Error Type', 24], ['Field', 28], ['Message', 90], ['Request Id', 30], ['Webhook Name', 40], ['Snapshot (webhook data received)', 80]].map(([header, width]) => ({ header, width }));
  for (const c of run.cases.filter(c => c.status !== 'PASS')) {
    const items = (c.issues?.length ? c.issues : [{ type: c.status === 'WAITING' ? 'waiting' : 'unknown', message: c.note || 'No details recorded' }]);
    for (const i of items) {
      const r = es.addRow([c.service, c.eventName ? `${c.eventName} (${c.event})` : c.event, c.templateName, c.status, i.type, i.path || '', cap(i.message), c.requestId || c.vars?.requestId || c.caseId, c.webhookName || '', c.received != null ? compact(c.received) : noSnapshot(run, c)]);
      r.getCell(4).font = { bold: true, color: { argb: COLORS[c.status] || 'FF000000' } };
      r.alignment = { vertical: 'top', wrapText: true };
    }
  }
  es.getRow(1).font = { bold: true }; es.views = [{ state: 'frozen', ySplit: 1 }]; es.autoFilter = { from: 'A1', to: 'J1' };
  sum.addRow(['Error rows', es.rowCount - 1]);

  // Full snapshot JSON, one row per case, pretty-printed.
  const ss = wb.addWorksheet('Snapshots');
  ss.columns = [['Service', 10], ['Event', 36], ['Template', 20], ['Status', 10], ['Request Id', 30], ['Received At', 22], ['Snapshot JSON (webhook data received)', 110]].map(([header, width]) => ({ header, width }));
  for (const c of run.cases) {
    const r = ss.addRow([c.service, c.eventName ? `${c.eventName} (${c.event})` : c.event, c.templateName, c.status, c.requestId || c.vars?.requestId || c.caseId, c.receivedAt || '', c.received != null ? cap(c.received) : noSnapshot(run, c)]);
    r.getCell(4).font = { bold: true, color: { argb: COLORS[c.status] || 'FF000000' } };
    r.alignment = { vertical: 'top', wrapText: true };
    r.getCell(7).font = { name: 'Consolas', size: 10 };
  }
  ss.getRow(1).font = { bold: true }; ss.views = [{ state: 'frozen', ySplit: 1 }]; ss.autoFilter = { from: 'A1', to: 'G1' };

  return wb.xlsx.writeBuffer();
}
