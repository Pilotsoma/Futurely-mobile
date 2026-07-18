# /project:fix — Targeted Bug Fix Workflow

## Usage
```
/project:fix [describe the bug or issue]
```

Examples:
- `/project:fix Login screen crashes when password field is empty`
- `/project:fix Grade sync returns 403 after token refresh`
- `/project:fix TypeScript error on line 42 of gradesApi.ts`
- `/project:fix` (no args — will ask which issue from the diagnostic report to fix)

---

## What This Command Does

Runs a focused, scoped fix workflow: diagnose root cause → identify responsible agent → fix → verify.
Minimizes blast radius — touches only the files that need to change.

---

## Step 0 — Identify the Issue

If $ARGUMENTS is empty:
> "Which issue do you want to fix? You can:
> - Paste the error message or describe the symptom
> - Reference an item from the diagnostic report (e.g., 'critical issue #2')
> - Paste the relevant file and line number"

If $ARGUMENTS is provided, proceed with it.

---

## Step 1 — Root Cause Analysis

Before writing any fix, do a root cause investigation:

```bash
# Check if there are related TypeScript errors
tsc --noEmit 2>&1 | grep -A 3 "[relevant file or keyword]"

# Check recent changes that might have introduced the bug
git log --oneline -20
git diff HEAD~5 -- [relevant files if known]
```

Then read the relevant source files to understand:
1. What the code is supposed to do (from context and naming)
2. What it's actually doing wrong
3. What changed recently that might have introduced this
4. What the fix should be

State your root cause hypothesis before writing any code:
> "Root cause: [explanation]. The fix is [approach]. I'll change [files]."

---

## Step 2 — Scope Assessment

Determine the right agent and how many files this touches:

| Fix scope | Approach |
|-----------|----------|
| 1–2 files, clear fix | Fix inline without spawning subagent |
| Backend-only, 3+ files | Invoke `backend-engineer` |
| Frontend/mobile-only | Invoke `frontend-engineer` |
| UI/styling only | Invoke `ui-engineer` |
| Integration/scraper | Invoke `integration-engineer` |
| AI/prompt | Invoke `ai-engineer` |
| Cross-cutting (multiple layers) | Invoke `architect` first for scoping |
| Security or compliance issue | Invoke `qa-engineer` first, then `architect` |

For a cross-cutting fix, always get an Architect scope assessment before touching code.

---

## Step 3 — Make the Fix

Apply the minimal fix that addresses the root cause. Do not:
- Refactor surrounding code unless it's causing the bug
- Add features not related to this bug
- Change APIs or interfaces without architect approval
- Add error handling for scenarios that cannot happen

After applying the fix, verify it compiles:
```bash
tsc --noEmit
```

If TypeScript errors remain from your fix, resolve them before proceeding.

---

## Step 4 — Verify the Fix

### Automated verification:
```bash
# Run relevant tests
npm test -- --testPathPattern=[relevant test file or module]

# Full test suite if the fix touches shared utilities
npm test
```

If tests don't exist for the fixed area, note this and recommend adding them.

### Manual verification checklist:
- [ ] The original symptom/error no longer occurs
- [ ] No TypeScript errors introduced
- [ ] No ESLint errors introduced
- [ ] Adjacent features not broken (test the surrounding area manually)
- [ ] Edge cases still handled (empty state, error state, auth failure)

### If a MCP browser/Playwright tool is active:
- Open the running app
- Reproduce the original steps that caused the bug
- Confirm the fix works end-to-end

---

## Step 5 — Assess if QA Review is Needed

A QA review is required if the fix:
- Touches authentication or authorization logic
- Touches any user data access or storage
- Touches credential handling
- Changes an API contract (request or response shape)
- Is in compliance-sensitive code (audit logging, consent flows)

For any of the above: invoke `qa-engineer` with the fix diff and context before considering it done.

For simple UI or non-sensitive logic fixes, QA is optional but recommended.

---

## Step 6 — Summary

After the fix is verified, produce a summary:

```
## Fix Complete: [Bug Title]

### Root Cause
[1–2 sentences explaining what was wrong and why]

### Fix Applied
[1–2 sentences describing what was changed]

### Files Changed
- [file] (modified)

### Verified By
[tests run / manual steps taken / tool used]

### Remaining Risk
[anything that wasn't fully tested, or follow-up needed — or "none"]

### Recommended Follow-Up
[suggest adding tests if missing, or "none"]
```
