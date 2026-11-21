// Single place that loads .env and exposes typed settings. Import this instead of 'dotenv/config'.
import 'dotenv/config';
import path from 'node:path';

const int = (name, def) => { const n = parseInt(process.env[name] ?? '', 10); return Number.isFinite(n) ? n : def; };

export const config = {
  port: int('PORT', 3000),
  runsDir: path.resolve(process.env.RUNS_DIR || 'data/runs'),
  // Panel behaviour
  liveConcurrency: int('LIVE_CONCURRENCY', 3),
  dryRunDelayMs: int('DRY_RUN_DELAY_MS', 1500),      // pause between dry-run calls (MSG91 rate-limits them)
  batchSize: int('BATCH_SIZE', 10),                   // cases per batch (bulk runs go batch by batch)
  batchPauseMs: int('BATCH_PAUSE_MS', 15000),         // cool-down between batches so MSG91 dry-run limits are not hit
  dryRunWaitMs: int('DRY_RUN_WAIT_MS', 180000),      // how long a dry-run case waits for its hit before FAIL
  collectIntervalMs: int('COLLECT_INTERVAL_MS', 20000),
  // viaSocket
  viasocket: {
    orgId: process.env.VIASOCKET_ORG_ID,
    projectId: process.env.VIASOCKET_PROJECT_ID,
    secret: process.env.VIASOCKET_EMBED_SECRET,
    receiverScriptId: process.env.VIASOCKET_RECEIVER_SCRIPT_ID,
    receiverUrl: process.env.VIASOCKET_RECEIVER_URL,
  },
};
