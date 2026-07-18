# /project:sprint — Multi-Feature Sprint Planner & Executor

## Usage
```
/project:sprint
/project:sprint [comma-separated list of features or goals]
/project:sprint P0  (runs only the highest-priority items from PROJECT.md)
```

Examples:
- `/project:sprint` (I'll ask what to include)
- `/project:sprint push notifications, grade sync improvements, parent dashboard polish`
- `/project:sprint P0` (critical blockers from PROJECT.md only)

---

## What This Command Does

Plans and executes a sprint of multiple features in priority order.
Each feature runs the appropriate subset of the 9-step workflow.
Features that share agents (e.g., two backend tasks) are batched efficiently.

---

## Step 0 — Sprint Definition

If $ARGUMENTS is empty, ask:
> "What's in this sprint? List the features, bug fixes, or goals you want to complete.
> I'll prioritize them, check scope against PROJECT.md, and build them in the right order."

If $ARGUMENTS is provided, use that as the feature list.

Then confirm with the user:
> "Here's what I'm planning for this sprint:
>
> **P0 (blocking, do first):** [list]
> **P1 (high value):** [list]
> **P2 (nice to have, if time permits):** [list]
>
> Does this priority order look right? Anything to add, remove, or re-order?"

Wait for confirmation before starting any implementation.

---

## Step 1 — Pre-Sprint Baseline

Before writing any code:

```bash
# Ensure clean starting state
git status --short        # confirm no unexpected uncommitted changes
tsc --noEmit              # confirm no pre-existing TypeScript errors
npm test -- --passWithNoTests  # confirm tests pass before we start
```

If there are pre-existing TypeScript errors, ask the user whether to fix them first or proceed knowing there are existing errors.

Read `.claude/context/PROJECT.md` to confirm which features are in-scope for the current phase.

---

## Step 2 — Architect Sprint Design

Invoke the `architect` subagent once for the entire sprint:

```
Design the following sprint features:
[list of all features from Step 0]

For each feature, provide:
1. Scope: which layers it touches (backend/frontend/mobile/AI/integration/infra)
2. Dependencies: which features must be done before this one can start
3. Task breakdown: which agents need to do what, with acceptance criteria
4. Compliance flags: any COMPLIANCE.md requirements triggered

Order the features to minimize context-switching between agents.
(e.g., batch all backend work before starting frontend work)
```

The Architect will produce a sprint plan. Review it with the user before proceeding.

---

## Step 3 — Execute Sprint in Batches

Execute features in the order the Architect defined, grouping by agent where possible.

### Recommended batching approach:
```
Round 1: All backend tasks (backend-engineer handles all DB/API changes across all features)
Round 2: All integration tasks (if any)
Round 3: All AI engineer tasks (if any)
Round 4: All frontend tasks (frontend-engineer handles all screens)
Round 5: All UI polish tasks (ui-engineer handles all components/animations)
Round 6: QA review (qa-engineer reviews all sprint output at once)
Round 7: DevOps (if any new infra across the sprint)
Round 8: Architect final approval
```

For each batch, invoke the appropriate subagent with:
- All tasks it needs to complete in this batch
- Relevant prior agent outputs
- Context files as needed

---

## Step 4 — Sprint Checkpoint (after each major batch)

After each batch completes, do a quick health check:

```bash
tsc --noEmit   # catch type errors introduced by this batch
npm test       # catch regressions
```

If errors appear, fix them before starting the next batch. Do not accumulate errors across batches.

---

## Step 5 — QA Sprint Review

After all implementation batches are complete, invoke `qa-engineer` with a sprint summary:

```
Review the following sprint output for:
- Security vulnerabilities
- Compliance gaps (COMPLIANCE.md)
- Missing test coverage
- API contract violations
- Cross-feature regressions

Sprint features completed:
[list]

All agent outputs:
[paste or reference each agent's handoff block]
```

QA verdicts:
- **PASS** → proceed to Step 6
- **REVISE** → route issues back to the responsible agent, fix, re-run QA for that feature
- **BLOCK** → stop sprint, invoke Architect

---

## Step 6 — Architect Sprint Sign-Off

Invoke `architect` with the sprint summary and QA verdict for final approval.

---

## Step 7 — Sprint Summary

After architect approval, produce a summary document:

```markdown
## Sprint Complete — [Date]

### Delivered
- [Feature 1]: [what was built]
- [Feature 2]: [what was built]

### Files Changed
[consolidated list from all handoff blocks]

### Migrations to Run
[commands, or "none"]

### Env Vars to Add
[list with descriptions, or "none"]

### Manual Steps for You
[anything the user needs to do: migrate, restart, update .env, test on device, etc.]

### QA Verdict
[PASS — with any notes]

### What Didn't Make the Sprint
[if any P2 items were deferred, note them here for next sprint planning]

### Suggested Next Sprint
[top 3 items to consider for the next sprint based on PROJECT.md roadmap]
```
