// MSG91 catalogs -> test cases.
// events: { supportedWebhooks: { servicesData: [{ service, events: [{ eventKey, displayName, allowedFieldList, defaultResPayloadFormat }] }] } }
// templates: array of { templateId, templateName, event, resPayloadFormat, method, headers, ... } (each tied to ONE event)
const asText = f => (f == null ? null : typeof f === 'string' ? f : JSON.stringify(f, null, 2));

export function extractEvents(raw) {
  const out = [];
  for (const s of raw?.supportedWebhooks?.servicesData || [])
    for (const e of s.events || [])
      out.push({ service: s.service, event: e.eventKey, displayName: e.displayName, allowedFields: e.allowedFieldList || [], defaultFormat: asText(e.defaultResPayloadFormat) });
  return out;
}

export function extractTemplates(raw) {
  const arr = Array.isArray(raw) ? raw : raw?.data || raw?.templates || [];
  return arr.map(t => ({
    id: t.templateId || t.id, name: t.templateName, event: t.event,
    method: t.method || 'POST', headers: t.headers || { 'Content-Type': 'application/json' },
    format: asText(t.resPayloadFormat),
  }));
}

export function buildCases(templatesRaw, eventsRaw) {
  const events = extractEvents(eventsRaw);
  const templates = extractTemplates(templatesRaw);
  const cases = [];
  for (const ev of events) {
    cases.push({ service: ev.service, event: ev.event, eventName: ev.displayName, templateId: 'default', templateName: 'Default payload',
      tpl: { method: 'POST', headers: { 'Content-Type': 'application/json' }, format: ev.defaultFormat } });
    for (const t of templates.filter(t => t.event === ev.event))
      cases.push({ service: ev.service, event: ev.event, eventName: ev.displayName, templateId: t.id, templateName: t.name, tpl: t });
  }
  const known = new Set(events.map(e => e.event));
  const orphans = templates.filter(t => !known.has(t.event)).map(t => ({ name: t.name, event: t.event }));
  return { templates, events, cases, orphans };
}
