// Compare what the webhook sent with what the template promised.
const PLACEHOLDER = /\{\{\s*([^}|\s]+)\s*(\|[^}]*)?\}\}/g;

const closeInTime = (a, b) => {
  const x = Date.parse(a), y = Date.parse(b);
  return !Number.isNaN(x) && !Number.isNaN(y) && /\d{4}-\d{2}-\d{2}T/.test(String(a)) && Math.abs(x - y) <= 120000; // ts etc. are stamped at send time
};

export function parseTemplate(fmt) {
  if (fmt == null) return null;
  if (typeof fmt === 'object') return fmt;
  try { return JSON.parse(fmt); } catch { return null; }
}

function flatten(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = obj;
  return out;
}

function fill(str, vars) {
  return String(str).replace(PLACEHOLDER, (m, n, f) => (!f && n in vars ? String(vars[n]) : m));
}

/**
 * tplFmt: resPayloadFormat; vars: variableValues (dry run) or null (live);
 * received: parsed body of the hit.
 */
const isDate = v => /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(String(v));

export function grade({ tplFmt, vars, received, expectedMethod, receivedMethod }) {
  const issues = [], warnings = []; // warnings: shown in the comparison, never fail the case
  const tpl = parseTemplate(tplFmt);
  if (received == null) return { status: 'FAIL', issues: [{ type: 'no_hit', message: 'No hit received' }], rows: [] };
  if (!tpl) return { status: 'ERROR', issues: [{ type: 'bad_template', message: 'Template is not valid JSON' }], rows: [] };

  const exp = flatten(tpl);
  const got = flatten(received);
  const rows = [];
  for (const [path, tplVal] of Object.entries(exp)) {
    const hasPlaceholder = typeof tplVal === 'string' && /\{\{/.test(tplVal);
    const simple = typeof tplVal === 'string' && /\{\{\s*[^}|\s]+\s*\}\}/.test(tplVal) && !/\|/.test(tplVal);
    const expected = vars && typeof tplVal === 'string' ? fill(tplVal, vars) : tplVal;
    if (!(path in got)) {
      issues.push({ type: 'missing_field', path, message: `Missing field ${path}` });
      rows.push({ path, expected, received: undefined, ok: false });
      continue;
    }
    const actual = got[path];
    let ok = true, soft = false;
    if (typeof actual === 'string' && /\{\{[^}]*\}\}/.test(actual)) {
      PLACEHOLDER.lastIndex = 0;
      ok = false; issues.push({ type: 'unresolved_placeholder', path, message: `${path} still contains a placeholder: ${actual}` });
    } else if (vars && simple && !/\{\{/.test(String(expected)) && String(actual) !== String(expected) && !closeInTime(actual, expected)) { // variables with no sample value are not compared
      ok = false;
      const msg = `${path}: expected "${expected}", got "${actual}"`;
      if (isDate(expected) && isDate(actual)) { soft = true; warnings.push({ type: 'date_mismatch_dry_run', path, message: msg + ' (ignored in dry run: dry-run sends dummy data)' }); }
      else issues.push({ type: 'value_mismatch', path, message: msg });
    } else if (!hasPlaceholder && String(actual) !== String(tplVal)) {
      ok = false; issues.push({ type: 'value_mismatch', path, message: `${path}: expected fixed value "${tplVal}", got "${actual}"` });
    }
    PLACEHOLDER.lastIndex = 0;
    rows.push({ path, expected: vars && simple || !hasPlaceholder ? expected : '(any value)', received: actual, ok, soft });
  }
  for (const path of Object.keys(got)) {
    if (vars && path === 'dryRun') continue; // MSG91 adds this marker to dry-run hits
    if (!(path in exp)) { issues.push({ type: 'extra_field', path, message: `Unexpected field ${path}` }); rows.push({ path, expected: undefined, received: got[path], ok: false }); }
  }
  if (expectedMethod && receivedMethod && expectedMethod.toUpperCase() !== receivedMethod.toUpperCase())
    issues.push({ type: 'method_mismatch', message: `Expected ${expectedMethod}, got ${receivedMethod}` });
  return { status: issues.length ? 'FAIL' : 'PASS', issues, warnings, rows };
}
