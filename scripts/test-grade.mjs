import { grade } from '../src/services/grade.js';
const fmt = '{"a":"{{a}}","b":"{{b}}","k":"fixed"}';
const t = (n, r, ok) => { const s = r.status; console.log(s === ok ? 'ok  ' : 'BAD ', n, s, r.issues.map(i => i.type).join(',')); };
t('dry pass', grade({ tplFmt: fmt, vars: { a: '1', b: '2' }, received: { a: '1', b: '2', k: 'fixed' } }), 'PASS');
t('dry mismatch', grade({ tplFmt: fmt, vars: { a: '1', b: '2' }, received: { a: '1', b: '9', k: 'fixed' } }), 'FAIL');
t('live pass', grade({ tplFmt: fmt, vars: null, received: { a: 'x', b: 'y', k: 'fixed' } }), 'PASS');
t('unresolved', grade({ tplFmt: fmt, vars: null, received: { a: '{{a}}', b: 'y', k: 'fixed' } }), 'FAIL');
t('missing+extra', grade({ tplFmt: fmt, vars: null, received: { a: 'x', z: 1, k: 'fixed' } }), 'FAIL');
t('no hit', grade({ tplFmt: fmt, received: null }), 'FAIL');
