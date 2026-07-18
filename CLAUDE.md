@AGENTS.md

# Claude Code — Futurely Mobile Orchestrator

This file is the master configuration for every Claude Code session on this project.
Read it completely before doing any work.

> **This repo was split out of the `Futurely` monorepo**
> (https://github.com/Pilotsoma/Futurely) on 2026-07-17 via `git subtree split`, so mobile
> work could proceed independently with full commit history preserved. The main repo still
> owns the backend API this app calls, the web portal, and the canonical product docs. The
> `.claude/context/` files here are duplicated copies as of the split date — if they drift
> from the main repo, treat the main repo as the source of truth and re-sync by hand. This
> repo has **no server-side code**; see `.claude/context/ARCHITECTURE.md` for how to run a
> backend locally to develop against.

---

## Session Start Protocol

At the start of EVERY new session, before touching any file, ask the user these questions.
Do not skip this — the answers change how you work.

### Question 1 — What are we doing today?
> "What do you want to build, fix, or change today?
> (New feature / bug fix / refactor / review / something else?)"

### Question 1a — Declare task scope (guardrail system)
Immediately after Question 1 is answered, update `.claude/guardrails/task-scope.json`'s
`in_scope` array with glob patterns covering the files/dirs this task will touch. A
`PreToolUse` hook (`.claude/hooks/guard-protected-paths.js`) enforces this: any `Edit`/
`Write` on an existing, git-tracked file that isn't in scope triggers a permission
prompt instead of running silently, and a fixed list of paths (env files, lockfiles, the
guardrail config itself) is always denied outright regardless of scope. New/untracked
files are never blocked. See `.claude/context/GUARDRAILS.md` for the full policy. Narrow
or clear `in_scope` back to `[]` when the task wraps up.

### Question 2 — What MCP tools do you have active?
> "Are any MCP tools connected right now? For example:
> - **GitHub MCP** — I can create PRs, check CI status, read and comment on issues
> - **Computer-use MCP** — I can screenshot and interact with a running iOS Simulator or
>   Android Emulator directly
> - **Filesystem / Shell** — I already have these built-in via Read, Edit, Write, Bash
>
> Type `/mcp list` in the Claude Code terminal to see what's active."

### Question 3 — Are your services running?
> "Quick check before I touch mobile code:
> - Is the Expo dev server running? (`npx expo start`)
> - Are you testing on a physical device (Expo Go), iOS Simulator, or Android Emulator?
> - Does `src/constants/api.ts` `API_BASE_URL` currently point at a host your
>   device/simulator can actually reach? (Physical device → your computer's LAN IP; Android
>   emulator → `10.0.2.2`; iOS simulator → `localhost`.) This is hardcoded per-developer and
>   the most common reason the app can't reach the backend.
> - Is a Futurely backend actually running and reachable at that address? (Clone
>   https://github.com/Pilotsoma/Futurely and run `backend/` — see this repo's README.)
> I'll need these to verify changes work."

---

## Mandatory Context: Read Before Every Session

1. `.claude/context/ARCHITECTURE.md` — tech stack, screen/navigation structure, backend
   dependency
2. `.claude/context/ENGINEERING_RULES.md` — code standards (non-negotiable)
3. `.claude/context/COMPLIANCE.md` — regulatory and data-handling requirements (read before
   any user-data work — this app displays student data even though it doesn't store it)
4. `.claude/context/DESIGN_SYSTEM.md` — colors, typography, component standards
5. `.claude/context/GUARDRAILS.md` — how the protected-file hook works and how to declare
   task scope (read before any edit)

If any context file is missing or noticeably outdated, tell the user before proceeding.

---

## Agent Routing

Route tasks as follows:

| Task type | Primary agent | Notes |
|-----------|--------------|-------|
| New feature — design & planning | `lead-architect` | Always invoke first |
| Existing feature — architecture question or scope change | `lead-architect` | Before writing any code |
| Screens, navigation, data fetching | `frontend-engineer` | — |
| UI components, animations, accessibility audit | `ui-engineer` | After frontend-engineer |
| AI Chat screen UI / handling AI responses | `ai-engineer` | AI itself runs server-side in the main repo — this is client-side only |
| Tests, security review, compliance audit, verdicts | `qa-engineer` | Always last before shipping |
| EAS builds, app store config, CI/CD | `devops-engineer` | When infra changes needed |
| Bug triage, design disagreement, final approval | `lead-architect` | Always last for sign-off |

Backend API routes, database schema, and third-party integration code live in the **main
repo** (`Pilotsoma/Futurely`), not here — a task that needs those changes isn't something
this repo's agents can complete alone; flag it and coordinate across both repos.

---

## Handoff Block Format (enforced across all agents)

Every agent output must end with exactly this:

```
---
FILES CHANGED:
- path/to/file.ts (created|modified|deleted)

DEPENDENCIES ADDED:
- package@version (or "none")

ENV VARS REQUIRED:
- VAR_NAME=description (or "none")

NEXT AGENT:
- [agent-name]: [specific instruction for what they need to do next]
```

---

## Escalation Rules

| Situation | What to do |
|-----------|------------|
| QA issues a BLOCK verdict | Stop all work immediately. Invoke `lead-architect`. Do not ship anything. |
| Any compliance question (COMPLIANCE.md) | Invoke `lead-architect` for a ruling before writing any code |
| Requirement is ambiguous or unclear | Ask the user to clarify before dispatching any agent |
| A change requires backend/API work | Flag it — that work happens in the main `Futurely` repo, not here |
| Any secret or credential appears in source code | Invoke `qa-engineer` to BLOCK. Do not commit. |
| Feature is outside current scope (see ARCHITECTURE.md "Scope note") | Flag it to the user and invoke `lead-architect` to approve scope expansion |

---

## Quick Reference: Slash Commands

| Command | What it does |
|---------|-------------|
| `/project:new-feature` | Design → implement → polish → test workflow for a new feature |
| `/project:diagnose` | Audits the current codebase state and surfaces issues |
| `/project:fix` | Targeted bug fix: identify root cause → fix → verify |
| `/project:sprint` | Plans and executes a batch of features in priority order |
| `/project:review` | Code, security, and compliance review of recent changes |

---

## Project-Specific Notes

- This repo has no backend, database, or server code — see `.claude/context/ARCHITECTURE.md`.
- `Futurely/` (nested inside this repo) is an unrelated Expo starter template with its own
  `node_modules`, excluded from `tsconfig.json` — don't edit it or treat it as part of this
  product.
- No `lint` script or test runner (Jest/Detox/Playwright) is installed in this repo yet.
  Verify before claiming tests ran.
- `AGENTS.md` documents the pinned Expo SDK version — check it (and `package.json`) before
  assuming any Expo API; don't trust doc links pinned to a different SDK version.
- A `PreToolUse` hook guards every `Edit`/`Write` against silently touching existing,
  working, git-tracked code — see `.claude/context/GUARDRAILS.md`. Declare task scope in
  `.claude/guardrails/task-scope.json` before editing existing files, or expect an `ask`
  permission prompt. A fixed list in `.claude/guardrails/protected-paths.json` (env files,
  lockfiles, the guardrail config itself) is denied outright no matter what.
