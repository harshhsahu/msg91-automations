# MSG91 Test Panel

A panel that tests MSG91 webhooks across **test, stage and prod**. For every service × event × template it
creates a webhook (live) or fires a dry run, receives the hit on a viaSocket receiver, and grades the received
data against the template, with Excel / CSV / JSON export.

## Quick start

```bash
npm install
cp .env.example .env          # then fill it in (see below)
npx -y viasocket-apps setup --no-open   # writes the viaSocket keys into .env
# the receiver flow is created from the panel (banner: 'Set up receiver') or: npm run setup:receiver
npm start                     # http://localhost:3000
```

## Folder structure

```
.
├── .env                      your settings and secrets (git-ignored)
├── .env.example              the same keys, empty: safe to commit
├── data/runs/                one JSON file per run (git-ignored)
├── data/receiver.json        receiver flow per viaSocket account (git-ignored)
├── docs/                     notes
├── public/index.html         the panel UI
├── scripts/
│   ├── setup-receiver.mjs    creates the receiver flow for the current viaSocket account if missing
│   ├── test-hit.mjs          posts a sample hit and reads it back from history
│   └── test-grade.mjs        unit checks for the grader
├── src/
│   ├── server.js             Express app and API routes
│   ├── config/env.js         loads .env, exposes typed settings
│   └── services/
│       ├── msg91.js          MSG91 API client (catalogs, create webhook, dry run), per environment
│       ├── catalog.js        turns the two catalog APIs into service × event × template cases
│       ├── receiver.js       the viaSocket receiver flow, per account
│       ├── runner.js         runs cases, collects hits, grades, saves runs
│       ├── grade.js          compares received data with the template
│       ├── xlsx.js           Excel export (Summary, Results, Errors, Snapshots)
│       └── viasocket.js      viaSocket client (viasocket-apps package)
└── viasocket-integrations/SKILL.md   the viaSocket skill pointer
```

## .env

| Section | Keys | Notes |
| --- | --- | --- |
| Panel | `PORT`, `RUNS_DIR`, `LIVE_CONCURRENCY`, `DRY_RUN_DELAY_MS`, `DRY_RUN_WAIT_MS` | optional; defaults in `src/config/env.js` |
| viaSocket | `VIASOCKET_ORG_ID`, `VIASOCKET_PROJECT_ID`, `VIASOCKET_EMBED_SECRET`, `VIASOCKET_AGENT_TOKEN` | change org/project anytime; secrets come from `viasocket-apps setup` |
| MSG91 | `MSG91_<TEST\|STAGE\|PROD>_BASE_URL`, `_COMPANY_ID`, `_AUTH_KEY` | sent as the `authkey` header; an environment is enabled once its base URL and key are set |

## Switching the viaSocket account

The viaSocket values in `.env` can be swapped at any time (currently a testing account). The receiver flow is kept
per account in `data/receiver.json`. After changing the values and restarting, the panel shows a banner if that
account has no receiver yet; click **Set up receiver** and it is created in the new account. Runs remember the account
they ran on, so old runs are only readable while `.env` points at that account.

## Modes

- **Dry run**: MSG91's dry-run API sends sample data to the receiver; the hit comes back inline. MSG91 rate-limits it, so cases run one at a time.
- **Live**: creates real saved webhooks (named `<runId>-<n> <event>`, max 50 chars). They receive data only when a real event fires.

## Grading

A case fails on: missing field, extra field, leftover `{{placeholder}}`, changed fixed value, wrong method, or no hit.
Dry runs also check values exactly (time fields allow 2 minutes). Variables with no sample value are not compared.
