# Bugsy: AI Bug Investigator (Sarvam)

Paste a bug report. Bugsy gathers evidence (repo source, PostHog events, Sentry exceptions), asks **Sarvam** (`sarvamai` SDK, `sarvam-105b`) to extract and synthesize, then **validates every citation in code** before showing a diagnosis. When evidence is insufficient it abstains instead of guessing.

Outcomes: `DIAGNOSED` · `NO_SESSION` (user not found) · `NO_DIAGNOSIS` (abstained) · `SKIPPED` (not a bug report).

## Quick start
```bash
npm install
npm run setup                    # interactive wizard -> .env  (or copy .env.example to .env)
npm run serve                    # http://localhost:3000 (investigate) and /dashboard.html (history)
npm run start -- --sample 0      # demo samples 0-3: diagnosed, no-session, vague, non-bug
npm run start -- --text "Checkout keeps spinning after clicking pay" --user u_1042 --demo
npm run start -- --text "..." --linear      # also file a Linear issue when DIAGNOSED
npm run start -- --map                      # (re)build the repo map for REPO_PATH
npm run once                                # process recent Slack messages once, reply in thread
npm test && npm run typecheck
```
CLI flags: `--text --user --from --to --demo --sample N --linear --map --slack-once`.

## Two agents
1. **Mapper agent (first time per repo).** On the first investigation of a repository it scans every file, extracts symbols (functions, classes, types), asks Sarvam for a one-line summary of each file (batched, in parallel, up to 300 files), and writes a permanent **Bugsy skill**:
   - `skills/bugsy-<repo>-<hash>/SKILL.md`: human-readable map with Claude-Code skill front matter.
   - `skills/bugsy-<repo>-<hash>/profile.json`: machine copy used by the RCA agent.
   Later runs load the cached map and refresh only files whose size or mtime changed. `--map` forces a rebuild. `skills/` is git-ignored because it describes your target repo.
2. **RCA agent (every bug report).** Uses the map instead of searching the whole codebase: ranks files by path/symbol/summary match, lets Sarvam pick up to 5 from that candidate list (paths the model invents are discarded), then reads only those files. Stack frames from Sentry are followed first. Without a repo map (or if mapping fails) it falls back to a keyword scan.

## Investigation flow
`src/engine/investigate.ts`
1. Record the report (evidence `E1`).
2. Parse and classify with Sarvam (zod-validated). Non-bugs end as `SKIPPED`.
3. PostHog events for the user and Sentry issues (stack trace, breadcrumbs). If a user id was given and every configured source finds nothing: `NO_SESSION`.
4. Repo: Sentry frames, then `repo.locate` via the map.
5. If nothing but the report was gathered: `NO_DIAGNOSIS`.
6. Sarvam synthesizes facts, inferences, unknowns, code refs, fix.
7. `src/engine/evidence.ts` validates (below). Run saved to `runs/<id>.json`.

### Evidence enforcement
- Evidence IDs (`E1…`) are minted only by `EvidenceStore` from real tool output; raw outputs are kept in the run record.
- Claims citing unknown IDs are dropped, as are claims with no citation and code refs not shown in the cited evidence (file and line range). Each rejection is recorded and lowers confidence by 0.1.
- A diagnosis needs a surviving fact citing non-report evidence, a stated root cause, and confidence >= `CONFIDENCE_THRESHOLD`. Otherwise it abstains with the reason.
- The UI separates observed facts from inferences and lists unknowns.

## Demo mode
Tick "Demo mode" or pass `--demo`/`--sample`. Repo, PostHog and Sentry data come from `fixtures/` and every evidence item is flagged **synthetic** (UI banner, Linear issue note). Sarvam is called for real if `SARVAM_API_KEY` is set; otherwise a labelled scripted stand-in (not an AI) is used. Live mode never uses fixtures. Samples: checkout spinner (diagnosable), unknown user (`NO_SESSION`), vague report (abstains), chit-chat (`SKIPPED`).

## Configuration (`.env`, see `.env.example`)
| Integration | Variables | If missing |
|---|---|---|
| Sarvam | `SARVAM_API_KEY`, `SARVAM_MODEL` (`sarvam-105b`), `SARVAM_TIMEOUT_S` | live mode refuses to start |
| Repository | `REPO_PATH` | repo tools logged as `skipped` |
| PostHog | `POSTHOG_API_KEY` (personal key), `POSTHOG_PROJECT_ID`, `POSTHOG_HOST` | `skipped` |
| Sentry | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_HOST` | `skipped` |
| Linear | `LINEAR_API_KEY`, `LINEAR_TEAM_ID` (optional; first team otherwise) | button returns a preview and sends nothing |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` | only `npm run once` needs it |
| Tuning | `CONFIDENCE_THRESHOLD` (0.6), `HTTP_TIMEOUT_S` (15), `PORT` (3000) | defaults |

Keys stay server-side. `.env`, `runs/*` and `skills/` are git-ignored. Integrations that are not configured are recorded as `skipped` in the tool-call history; Bugsy never claims a service was queried when it was not.

## Slack bot setup
1. https://api.slack.com/apps -> Create New App -> From scratch (suggested name: Bugsy).
2. OAuth & Permissions -> Bot Token Scopes: `channels:history`, `chat:write` (`groups:history` for private channels). Install to workspace and copy the `xoxb-` token.
3. Create a channel (e.g. `#bugs`), `/invite @bugsy`, and copy its channel ID (channel details -> bottom).
4. Set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` (wizard or `.env`).
5. `npm run once` investigates recent un-replied messages and replies in the thread. Schedule it (cron/Task Scheduler) for continuous use. Common errors: `not_in_channel`, `missing_scope`, `invalid_auth`.

## Linear
`POST /api/runs/:id/linear` (the "Create Linear issue" button, or `--linear`) files the diagnosis, facts, code refs, fix, unknowns and evidence list. Only `DIAGNOSED` runs can be filed, and only on explicit user action. The result link is saved on the run and shown in the dashboard.

## Dashboard and history
`/dashboard.html` reads `runs/*.json` (no database): timestamp, mode, outcome, confidence, duration, tool-call history, abstention reasons, evidence and Linear links.

## HTTP API
`GET /api/config` · `POST /api/investigate` · `GET /api/runs` · `GET /api/runs/:id` · `POST /api/runs/:id/linear`. The server binds to 127.0.0.1.

## Security
- Repo access is confined to `REPO_PATH`: no absolute paths, `..`, symlink escapes, or `.env`/key/pem files; `node_modules`, `.git`, build output are skipped.
- PostHog user ids and timestamps are allow-list validated before being placed in HogQL.
- UI renders all dynamic text via `textContent` (no HTML injection from evidence).
- HTTP calls have timeouts and retry on 429/5xx; Linear issue creation is never retried.

## Layout
```
src/ai/            Sarvam provider (JSON mode, validation, retry) and prompts
src/agents/        mapper (builds the Bugsy skill) and locate (RCA file selection)
src/integrations/  repo, posthog, sentry, linear, slack
src/engine/        investigate, evidence validation, run storage, Linear report
src/server.ts      API + static UI      src/cli.ts  CLI      src/setup.ts  wizard
public/            index.html, dashboard.html, ui.js, style.css
fixtures/          synthetic demo data, demo repo, scripted demo provider
tests/             vitest suites (mocked clients, deterministic fixtures)
```

## Status and limits
- Automated tests (vitest) cover outcomes, evidence validation, tool failures, repo path safety, JSON extraction and the repo map. The mapper/locate changes were type-checked and unit-tested, but the full flow with the map has not been re-run end to end after the final changes.
- PostHog, Sentry, Linear and Slack clients follow the public APIs but have not been exercised against live accounts.
- Slack ingestion is poll-once (no Events API / Socket Mode listener).
- Bugsy recommends fixes only; it never edits code. An approved-fix workflow could be added on top of the run records.
- Model output varies between runs; vague reports may abstain.

## Troubleshooting
- `SARVAM_API_KEY is not set`: run `npm run setup`.
- Empty/unusable model output: reasoning tokens count against `max_tokens` (set to 12000); check the `finish_reason` in the error.
- Many `NO_DIAGNOSIS`: include a user id, error text or function names, configure Sentry/PostHog, and run `--map` after big repo changes.
- Linear 503: set `LINEAR_API_KEY`.
