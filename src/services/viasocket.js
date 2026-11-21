import { config } from '../config/env.js';
import { ViaSocket } from 'viasocket-apps';

export const viasocket = new ViaSocket({
  orgId: config.viasocket.orgId,
  projectId: config.viasocket.projectId,
  secret: config.viasocket.secret,
});
// One owner identity for all panel-created flows.
export const owner = viasocket.user('msg91-webhook-panel');
