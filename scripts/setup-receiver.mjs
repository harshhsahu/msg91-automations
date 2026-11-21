import { ensureReceiver } from '../src/services/receiver.js';
const r = await ensureReceiver();
console.log(r.created ? 'Created receiver' : 'Receiver already ready', r.scriptId, 'for viaSocket org', r.account.orgId);
