import '../src/config/env.js';
import { owner } from '../src/services/viasocket.js';
const url = process.env.VIASOCKET_RECEIVER_URL;
const r = await fetch(url + '?case=qs-1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-case-id': 'T-test-1' }, body: JSON.stringify({ requestId: 'abc', reason: 'hello' }) });
console.log('post', r.status, (await r.text()).slice(0, 300));
await new Promise(r => setTimeout(r, 75000));
const h = await owner.runHistory(process.env.VIASOCKET_RECEIVER_SCRIPT_ID, { page: 1, limit: 5 });
console.log(JSON.stringify(h, null, 1).slice(0, 3000));
