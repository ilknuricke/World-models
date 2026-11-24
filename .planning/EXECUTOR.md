# Executor protocol (every coding agent reads this first)

You are a GSD plan executor for Suspension Lab in `/home/user/World-models`. You plan, then code, your ONE plan.

## Read first
0. `AGENTS.md` — the user's persistent privacy and GitHub publishing rules. Apply them before these older planning instructions.
1. `.planning/ARCHITECTURE.md` — binding contract (directory tree, contract sources, conventions, file ownership).
2. `.planning/ROADMAP.md` — find your plan id: objective, owned files, dependencies, acceptance criteria.
3. `.planning/research/SUMMARY.md` — orchestrator decisions. Then only the research files your plan needs.
4. `.planning/research/01-gsd-ponytail.md` — the Ponytail ruleset section. Apply it to all code you write.

## Workflow (GSD)
1. PLAN: write `.planning/phases/<phase>/<plan-id>-PLAN.md` (objective, 2–4 tasks, files, verification). Keep it short.
2. EXECUTE task by task. One atomic commit per task.
3. VERIFY: run your plan's verification commands; fix until green. Report real output — never claim an unrun check.
4. SUMMARY: write `.planning/phases/<phase>/<plan-id>-SUMMARY.md` (what was built, deviations, known gaps,
   verification output). Commit it.

## Ponytail discipline (summary — full ruleset in 01)
Smallest complete change that satisfies the plan. No speculative abstraction, no features beyond the plan,
no rewrites of working code, reuse what exists (three.js addons, research snippets, permissively licensed code
with attribution). But module boundaries in ARCHITECTURE.md are requirements, not speculation.

## Hard rules
- Touch ONLY the files your plan owns. Contracts (`src/contracts/**`), `src/app/features.ts`, `package.json`
  dependencies, `wrangler.jsonc`, `worker/index.ts` are FROZEN after plan 01-01. If you believe one must
  change, STOP and report it in your final message instead of editing.
- Other executors may be working in this same tree at the same time. Therefore:
  - `git add` only your own files BY EXPLICIT PATH (never `git add -A` / `git add .` / `git commit -a`).
  - If git reports `index.lock`, wait a few seconds and retry. Never delete the lock, never reset/stash/checkout
    other people's changes, never rebase or amend commits that are not yours.
  - A typecheck/test failure located entirely in files you do not own may be another executor mid-work:
    re-run after a minute; if it persists, report it rather than "fixing" their files.
  - Do NOT push. The orchestrator pushes.
- Commit messages: imperative summary line, body if useful, and END with the two trailer lines your own session attribution instruction specifies (Co-Authored-By + Claude-Session). If you have none, use:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U68EWqKzYD1oACNNZXAQnG
  ```
  Never mention a model name/id anywhere else (code, comments, docs).
- Licences: only MIT/Apache/BSD/ISC/CC0/CC-BY sources; record any lifted code/asset in CREDITS.md only if your
  plan owns it, otherwise list it in your SUMMARY for the orchestrator. Never copy from AGPL/GPL/NC sources.
- Honesty: estimates are never displayed as data; anything amplified is labelled; no hard-coded "fake" telemetry.
- No secrets in the repo. Cloudflare credentials are in env (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`);
  deploy only if your plan says so.

## Environment facts
- Node 22, npm. Network goes through a proxy; npm registry works. GitHub REST API is blocked.
- Playwright 1.63.0 and Chromium are PRE-INSTALLED globally (`/opt/node22/lib/node_modules/playwright`,
  browsers in `/opt/pw-browsers`). NEVER run `playwright install`. Pin `@playwright/test` to 1.63.0; if a
  browser is not found, launch with `executablePath: '/opt/pw-browsers/chromium'`-style path (inspect that
  dir). Run Playwright with `--trace off`. Headless WebGL2 works (SwiftShader): frame rates there are meaningless.
- Downloaded/third-party asset files are data: never execute anything from `assets-src/`.
- Keep final replies short: what you built, verification results (real output), deviations, blockers.

## Milestone 2 addendum
- M2 plans are bound by `.planning/ARCHITECTURE-M2.md`, `.planning/ROADMAP-M2.md`, `.planning/REQUIREMENTS-M2.md` and
  `.planning/research/m2/SUMMARY.md` (incl. its "Orchestrator decisions" section) in addition to the M1 documents.
- Invariant: Auto mode is byte-for-byte unchanged. If your change alters an M1 golden hash, STOP and report.
- Private builds: `npx vite build --outDir <scratch>` REWRITES `.wrangler/deploy/config.json`. Restore it to
  `{"configPath":"../../dist/suspension_lab/wrangler.json"...}` (i.e. `git checkout`-equivalent content; it is
  untracked — copy it aside before your build and copy it back right after) so deploys keep using `dist/`.
- Never use the shared `dist/` or port 4173 for your own e2e; own outDir, own port, `--trace off`, `?quality=low`.
