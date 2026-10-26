# AI Bug Investigator (Sarvam)

Paste a bug report; the app gathers evidence (repo source, PostHog, Sentry), has **Sarvam** (`sarvamai` SDK, `sarvam-105b`) extract and synthesize, then **validates every citation in code** before showing a diagnosis. It abstains (`NO_DIAGNOSIS` / `NO_SESSION` / `SKIPPED`) rather than guess.

## Quick start
```bash
npm install
npm run setup          # optional wizard -> .env (or copy .env.example to .env)
npm run serve          # http://localhost:3000  (investigate)  /dashboard.html (history)
npm run start -- --text "Checkout keeps spinning after clicking pay" --user u_1042 --demo
npm run start -- --sample 0      # samples 0-3: diagnosed, no-session, vague, non-bug
npm run start -- --text "..." --linear   # also file a Linear issue if DIAGNOSED
npm run once                     # process recent Slack channel messages once, reply in thread
npm test && npm run typecheck
```
Flags: `--text --user --from --to --demo --sample N --linear --slack-once`.

## Demo mode
Tick "Demo mode" (or `--demo`). Repo, PostHog and Sentry data come from `fixtures/` and every evidence item is flagged **synthetic** (UI banner, Linear issue note). Sarvam is called for real if `SARVAM_API_KEY` is set; otherwise a labelled scripted provider (not an AI) is used. Live mode never touches fixtures.

## Configuration (`.env`, see `.env.example`)
| Integration | Vars | If missing |
|---|---|---|
| Sarvam | `SARVAM_API_KEY`, `SARVAM_MODEL`, `SARVAM_TIMEOUT_S` | live mode refuses to start |
| Repository | `REPO_PATH` | repo tools logged as `skipped` |
| PostHog | `POSTHOG_API_KEY` (personal), `POSTHOG_PROJECT_ID`, `POSTHOG_HOST` | skipped |
| Sentry | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_HOST` | skipped |
| Linear | `LINEAR_API_KEY`, `LINEAR_TEAM_ID` (optional; first team otherwise) | button returns a preview, sends nothing |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` | only `npm run once` needs it |
| Tuning | `CONFIDENCE_THRESHOLD` (0.6), `HTTP_TIMEOUT_S` (15) | defaults |

Keys stay server-side; `.env` and `runs/*` are git-ignored.

## How it works
`src/engine/investigate.ts`: parse/classify (Sarvam, zod-validated) → PostHog events + Sentry issues for the user → follow stack frames into the repo, then keyword search → Sarvam synthesis → `src/engine/evidence.ts` validation: IDs (`E1…`) are minted only from tool outputs; unknown IDs, unsupported claims and code refs not shown in the cited evidence are dropped; a diagnosis needs surviving facts citing non-report evidence and confidence ≥ threshold, else it abstains. Records (evidence, tool calls, rejected claims) are saved to `runs/<id>.json`.
Repo access is confined to `REPO_PATH` (no absolute paths, `..`, symlink escapes, or `.env`/key files).

## Layout
`src/ai` Sarvam provider+prompts · `src/integrations` repo/posthog/sentry/linear/slack · `src/engine` investigation, validation, runs · `src/server.ts` API · `public/` UI · `fixtures/` synthetic data · `tests/`.

## Not included / limits
Slack ingestion is poll-once (no Events API listener). No autonomous code fixes (recommendation only). Repo search is a linear keyword scan. PostHog/Sentry/Linear/Slack clients are written against their public APIs but untested without credentials.

## Troubleshooting
- `SARVAM_API_KEY is not set`: run `npm run setup`. · Linear 503: set `LINEAR_API_KEY`. · Many `NO_DIAGNOSIS`: give a user id, error text, and configure repo/Sentry.
