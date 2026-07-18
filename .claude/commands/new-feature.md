# /project:new-feature — Full Feature Build Workflow

## Usage
```
/project:new-feature [describe the feature you want to build]
```

Example: `/project:new-feature Add a push notification when an assignment is due in 24 hours`

---

## What This Command Does

Runs the full 9-step feature workflow using the multi-agent team.
Each step must complete before the next begins.

---

## Step 0 — Scope Clarification (always run first)

Before dispatching any agent, ask the user:

1. **What is the feature?** (if not provided in $ARGUMENTS, ask now)
2. **Which surfaces does it touch?** (backend only / frontend only / both / mobile / web / AI feature / integration / new infra)
3. **Is this in scope for the current phase?** (check `.claude/context/PROJECT.md` — if not, flag it and ask if they want to expand scope)
4. **Are there any known constraints?** (deadline, specific library to use, must not touch certain files)
5. **Does it touch user or sensitive data?** (if yes, COMPLIANCE.md gates apply)

Once scope is confirmed, proceed to Step 1.

---

## Step 1 — Architect: Design & Task Breakdown

Invoke the `architect` subagent with:

```
Feature to design: [feature description from $ARGUMENTS + clarification]

Context to provide:
- Contents of .claude/context/PROJECT.md
- Contents of .claude/context/ARCHITECTURE.md
- Contents of .claude/context/ENGINEERING_RULES.md
- Contents of .claude/context/COMPLIANCE.md

Produce:
1. Architecture Decision (data models, API contracts, module boundaries)
2. Task breakdown — one task per agent, with specific acceptance criteria
3. Risks and mitigations
4. Compliance check (does this touch user data? which COMPLIANCE.md sections apply?)
5. Blocked-until list (any prerequisites)
```

**Gate:** Do not proceed past Step 1 until the Architect's output includes all five items above.

---

## Step 2 — Backend Engineer: API + Database + Logic

Only run if the feature requires backend changes (API routes, DB schema, business logic).

Invoke the `backend-engineer` subagent with:
- The Architect's full output from Step 1
- Relevant sections of ARCHITECTURE.md and ENGINEERING_RULES.md

**Gate:** Backend output must pass the self-review checklist (auth guard, validated DTOs, user-scoped queries, compliance log, no console.log, no secrets in code).

---

## Step 3 — Integration Engineer: External Connectors

Only run if the feature requires connecting to an external system (OAuth, scraper, sync worker).

Invoke the `integration-engineer` subagent with:
- The Architect's task brief from Step 1
- The Backend agent's data service interface from Step 2
- COMPLIANCE.md and ARCHITECTURE.md

**Gate:** All security checklist items must be satisfied (secrets manager only, no PII in logs, rate limiting, isolated worker process).

---

## Step 4 — AI Engineer: Prompts + LLM Integration

Only run if the feature includes AI/LLM functionality.

Invoke the `ai-engineer` subagent with:
- The Architect's task brief from Step 1
- The Backend agent's data schemas from Step 2
- PROJECT.md (AI feature scope) and COMPLIANCE.md

**Gate:** Every LLM call must have: a Zod validation schema, a rule-based fallback, and a Jest test with a mocked LLM response.

---

## Step 5 — Frontend Engineer: Screens + State + API Wiring

Only run if the feature has a UI (mobile screen, web page, navigation change).

Invoke the `frontend-engineer` subagent with:
- The Backend agent's API contracts (endpoints, request/response shapes) from Step 2
- AI Engineer output from Step 4 (if applicable)
- ARCHITECTURE.md and DESIGN_SYSTEM.md

**Gate:** Every screen must handle loading (skeleton), error (with retry), and empty states.

---

## Step 6 — UI Engineer: Polish + Accessibility

Run after Step 5 whenever new screens or components were created.

Invoke the `ui-engineer` subagent with:
- The Frontend agent's output from Step 5
- DESIGN_SYSTEM.md

**Gate:** Accessibility checklist must be completed (contrast, touch targets, labels, reduced motion).

---

## Step 7 — QA Engineer: Tests + Security + Compliance Verdict

Always run. This is the last gate before shipping.

Invoke the `qa-engineer` subagent with:
- ALL agent outputs from Steps 2–6 that are relevant to this feature
- COMPLIANCE.md and ENGINEERING_RULES.md

**Gate:**
- **PASS** → proceed to Step 8
- **REVISE** → route issues back to the responsible agent, re-run that step, re-run QA
- **BLOCK** → stop immediately, invoke Architect, do not ship

---

## Step 8 — DevOps Engineer: Deploy Config

Only run if the feature requires new infrastructure (new env var, new cloud resource, new CI step).

Invoke the `devops-engineer` subagent with:
- The feature summary and any new infrastructure identified in the handoff blocks
- ARCHITECTURE.md and COMPLIANCE.md

**Gate:** All three environments (dev/staging/prod) must be accounted for. No secrets in committed files.

---

## Step 9 — Architect: Final Approval

Always run last.

Invoke the `architect` subagent with:
- All agent outputs from Steps 2–8
- QA verdict from Step 7

The Architect issues: **APPROVED** (ship it) or **REVISE/BLOCK** (specific issues listed).

---

## Session Summary

After Step 9, produce a summary for the user:

```
## Feature Complete: [Feature Name]

### What was built
[2–3 sentence summary]

### Files changed
[list from all handoff blocks]

### Dependencies added
[list or "none"]

### Migrations to run
[commands to run, or "none"]

### Env vars to add
[list with descriptions, or "none"]

### Manual steps required
[anything the user must do: npx prisma migrate dev, restart server, update .env, etc.]

### QA verdict
[PASS — with any notes]
```
