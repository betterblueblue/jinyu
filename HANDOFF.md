# HANDOFF — 瑾瑜（jinyu）

Date written: 2026-07-23  
Workspace: `E:\agent\jinyu`  
Audience: new session with **no** prior chat context.

This file is context only — **not** authorization to change code, deploy, commit, or rotate secrets.

---

## 1. Task — what we are doing

### Goal

Build **瑾瑜 / jinyu**: greenfield web app for baby naming.

User flow: **login → form → one-shot formal online report → download summary PNG → history snapshots**.

### Scope (product)

- Fixed single preset account (no open registration).
- LLM candidates + **server hard gate** (L1 anti-viral names, taboo, generation char, name length).
- Soft prefs: default style **端庄耐看** (not exposed on form).
- Optional bazi (default off, restrained wording).
- Storage: local JSON snapshots under `data/` (not SQLite in current code).
- Independent of `jinyutreasury` runtime; culture/UI may be adapted from it.

### Success criteria (MVP)

- Full online report viewable.
- Summary image downloadable.
- History opens **frozen** snapshot (no re-run LLM).
- Automated tests with Fake LLM; real LLM for product default.

### Sources of truth

| Doc | Path |
|---|---|
| PRD | `docs/PRD.md` |
| INTENT | `docs/intent/2026-07-23-001-jinyu.md` |
| Tech stack | `docs/TECH.md` |
| UI | `docs/UI.md` |
| Issues (14 slices) | `issues/01` … `issues/14` (all marked `Status: done`) |
| LLM bench conclusion | `data/llm-bench-latest.md` |

---

## 2. Done — decisions, code, verification

### Key decisions (user-confirmed or product)

| Decision | Detail |
|---|---|
| Brand / slug | 瑾瑜 / `jinyu` (not baby-name-web) |
| Stack | Next.js App Router + TS + Tailwind + Zod + Vitest + Playwright |
| Storage | **JSON files** in `data/reports/` + `data/index.json` (TECH originally said SQLite; implementation chose JSON to avoid native deps) |
| Default LLM | **StepFun `step-3.7-flash`**, OpenAI-compatible Chat Completions |
| Default LLM mode | **`LLM_USE_FAKE=false`** for local product use |
| Style UI | **Removed** style prototype cards from form; always `default_dignified` |
| Docs layout | PRD/TECH/INTENT under `docs/`; issues at repo root `issues/` |
| LLM comparison | Prefer **step-3.7-flash** over DeepSeek-V4-Flash for default (see §2.4) |

### Major implementation areas

```
app/                    # Next routes: login, name, reports/[id], history, about, APIs
src/domain/             # normalizer, gate, soft-ranker, bazi, assembler, orchestrator
src/providers/          # FakeProvider, StepFunProvider, createCandidateProvider
src/store/report-store.ts
src/auth/session.ts
src/render/summary-card.tsx
src/config/             # l1-templates.json, l2-chars.json, style-prototypes.ts
src/components/AppShell.tsx
tests/                  # unit (Fake LLM)
e2e/golden-path.spec.ts # Playwright (forces Fake via playwright.config.ts)
scripts/                # probes + LLM bench
```

### UI

- Base tokens in `app/globals.css` + `tailwind.config.ts` (paper/ink/jade aesthetic).
- OpenDesign-style pass applied to pages (login, form sections, report, history, about, sticky submit, `btn-*` classes).
- Small follow-ups applied after review:
  - Form copy: 避讳 vs 辈分 wording fixed in `app/name/naming-form.tsx`.
  - `on-surface-variant` → `#404945` in `tailwind.config.ts`.
  - Report page title hierarchy: 命名结果 + 总览 section in `app/reports/[id]/page.tsx`.

### Verifications that **passed** (this workspace)

| Check | Command / method | Result |
|---|---|---|
| Unit tests | `pnpm test` | Exit **0**; **14/14** passed (re-run 2026-07-23 late session) |
| Typecheck + build | `pnpm typecheck`; `pnpm exec next build` | Passed earlier in session (after `next.config` fix) |
| Playwright E2E (Fake) | `pnpm e2e` | **1 passed** (login→form→report→summary download→history) |
| Real StepFun HTTP | `node scripts/probe-stepfun.mjs` | HTTP 200, candidates returned |
| Real StepFunProvider | `pnpm exec tsx scripts/probe-provider.ts` | 6 candidates, gate pass |
| Real E2E HTTP path | `node scripts/e2e-real-llm.mjs` against running `pnpm dev` | login→generate (~48s)→report page→PNG→history OK |
| LLM bench final | `scripts/bench-deepseek-only.mjs` + prior step half | See `data/llm-bench-latest.md` |

### LLM bench final numbers (`data/llm-bench-latest.md`)

| Model | Success | Avg score | Avg latency | Field completeness | Fallback rate |
|---|---:|---:|---:|---:|---:|
| step-3.7-flash | 10/10 | 100 | ~24352 ms | 1.0 | 0 |
| DeepSeek-V4-Flash (user relay) | 10/10 | 85.5 | ~33989 ms | 0.683 | 0.5 |

**Recommendation recorded:** keep **step-3.7-flash** as product default; DeepSeek only as optional backup env (`DEEPSEEK_*` in `.env.local`).

### Critical product bug fixed

`step-3.7-flash` often returns empty `message.content` and puts text in `reasoning` / `reasoning_content`.

**Fix:** `src/providers/stepfun-provider.ts` — read content → reasoning JSON → quote-name fallback; `max_tokens: 4096`; prompt insists content is JSON only.

Without this fix, generate can “succeed” with **zero candidates**.

---

## 3. Current status and open items

### Working

- Application code present; `issues/*` all `Status: done`.
- Unit tests green at handoff time.
- Product LLM default = real StepFun when key present and `LLM_USE_FAKE=false`.

### Not running now

- **Port 3000 has no listener** (checked at handoff). Dev server is **down**. Start with `pnpm dev` if UI needed.

### Gaps / risks (not necessarily blockers)

| Item | Status |
|---|---|
| Git repo | **Not a git repository** — no branch, no commits, no remote |
| `next@15.1.0` | Install warned **deprecated / security** (CVE mentioned by pnpm); not upgraded |
| DeepSeek as product provider | Env keys exist; **app `createCandidateProvider` only wires Fake vs StepFun** — DeepSeek not integrated as selectable provider in app code |
| Summary PNG after OpenDesign tweaks | Real download verified earlier; **re-verify after latest UI/summary-card changes** not re-run at handoff |
| Playwright after late UI copy changes | E2E uses `data-testid`; should still work — **not re-run at handoff** |
| Secrets in chat history | User pasted API keys in conversation; keys live in `.env.local` (gitignored). **Rotation recommended** if chat is shared |
| SiliconFlow DeepSeek | Historical bench hit **insufficient balance**; user later provided another relay |

### User decisions already made (do not re-open without asking)

- No style cards on form.
- Default real LLM, not Fake.
- Prefer Step over DeepSeek for default.

### Needs user decision (if continuing)

- Whether to `git init` / push remote.
- Whether to upgrade Next for security.
- Whether to productize DeepSeek fallback in `createCandidateProvider` (currently only env for bench/scripts).
- Whether to rotate StepFun / DeepSeek keys after chat exposure.

---

## 4. Next steps (ordered)

1. **Boot app**  
   - `pnpm install` (if needed)  
   - `pnpm dev`  
   - Open `http://127.0.0.1:3000/login`  
   - Credentials: see `.env.local` keys `JINYU_AUTH_*` (defaults documented in `.env.example`: username `jinyu`)  
   - Verify: login OK; submit form; wait ~20–40s for real LLM; report + download image.

2. **Regression after latest edits**  
   - `pnpm test` → expect 14 pass  
   - `pnpm e2e` → expect golden path pass (Fake forced by Playwright config)  
   - Optional: `node scripts/e2e-real-llm.mjs` with dev server up and `LLM_USE_FAKE=false`

3. **If production-hardening**  
   - Upgrade Next past vulnerable 15.1.0  
   - `git init` + ensure `.env.local` never committed  
   - Consider rotating API keys  

4. **If DeepSeek backup in app**  
   - Extend `src/providers/index.ts` to read `DEEPSEEK_*` or `LLM_PROVIDER`  
   - Keep Fake for tests  
   - Re-run bench / one real generate  

5. **Optional quality**  
   - Hard-filter brand name 瑾瑜 / garbage tokens from fallback extraction  
   - Strengthen L2 / semantic bad-name filters  

---

## 5. Pitfalls — do not repeat

| Pitfall | Why |
|---|---|
| Only read `choices[0].message.content` for Step | Often empty; candidates live in `reasoning` |
| Assume Fake when user wants product demo | User insisted default real LLM; set `LLM_USE_FAKE=false` |
| Shell env override of `LLM_USE_FAKE` / auth | Can shadow `.env.local`; clear env before `pnpm dev` |
| SiliconFlow DeepSeek without balance | 403 `account balance is insufficient` |
| Trust early LLM bench v1 scores | First bench had parse bugs and empty Step results; use **latest** report only |
| Style cards “must” return | User removed them for form simplicity |
| Import/runtime couple to `jinyutreasury` | Forbidden; copy only |
| Commit `.env.local` | Contains live keys; gitignored |
| Use `sleep` loops in agent for long waits | Prefer background tasks; prior hung full dual-bench process |
| Report form copy “填写后不会出现在推荐名” for 辈分 | Wrong: 辈分 must appear; fixed wording |

### Useful commands (non-secret)

```bash
pnpm install
pnpm dev
pnpm test
pnpm e2e
pnpm typecheck
pnpm build
node scripts/probe-stepfun.mjs
pnpm exec tsx scripts/probe-provider.ts
node scripts/e2e-real-llm.mjs          # needs dev server
node scripts/bench-llm-models.mjs      # dual model (needs keys)
node scripts/bench-deepseek-only.mjs   # DeepSeek relay only
node scripts/probe-deepseek-relay.mjs
```

---

## 6. Workspace state

| Item | Value |
|---|---|
| Path | `E:\agent\jinyu` |
| Git | **Not a git repository** |
| Branch / uncommitted | N/A |
| Package manager | pnpm (lockfile present) |
| `node_modules` | Present |
| `.next` | Present (prior builds) |
| Dev server | **Not listening on 3000** at handoff |
| Snapshot data | `data/index.json` + reports count **9** (local artifacts) |
| User-only secrets | `.env.local` (do not print or commit) |
| Do not delete | `docs/*`, `issues/*`, user `.env.local`, `data/llm-bench-latest.*` without ask |

### Env keys present in `.env.local` (names only)

`JINYU_AUTH_USERNAME`, `JINYU_AUTH_PASSWORD`, `JINYU_SESSION_SECRET`, `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_USE_FAKE`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`

`.env.example` documents auth + StepFun LLM; may not list `DEEPSEEK_*` (check file before documenting).

### Reference code outside repo

- Cultural/visual reference: `D:\MyPythonProject\awsome-skill\jinyutreasury` (do not depend at runtime).

---

## 7. How a new session should start

### Read first (in order)

1. This file: `HANDOFF.md`  
2. `README.md`  
3. `docs/TECH.md`, `docs/UI.md` (skim `docs/PRD.md` if product questions)  
4. `data/llm-bench-latest.md` if LLM choice comes up  
5. `src/providers/stepfun-provider.ts` + `src/providers/index.ts` if LLM bugs  
6. `issues/*` only if reopening a slice  

### Read-only checks

```bash
cd E:\agent\jinyu
pnpm test
# optional: Test-NetConnection 127.0.0.1 -Port 3000
```

### First constructive action (if continuing product work)

- Start `pnpm dev`, smoke login + one real generate, **or**  
- Run `pnpm e2e` + `pnpm test` after any code change, **or**  
- Implement only what user asks next (no unsolicited large refactors).

### Auth smoke

- Login API expects preset user from env (see `.env.example`).  
- Wrong password must 401; correct returns `{ ok: true }`.

---

## Self-check

- Distinguishes done vs open vs not re-verified at handoff.  
- Paths and commands concrete; no secret values.  
- Does not claim git history or running server without evidence.  
- LLM default and Step reasoning-parse fix are explicit.  
- New agent can continue from this file alone.
