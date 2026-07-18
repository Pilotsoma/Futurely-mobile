# /project:diagnose — Codebase Audit & Health Check

## Usage
```
/project:diagnose
/project:diagnose [specific area: backend | frontend | mobile | database | integrations | ai | devops | compliance]
```

If no area is specified, run a full-spectrum audit.

---

## What This Command Does

Produces a structured diagnostic report of the current codebase state.
Does NOT make code changes — diagnosis only. Use `/project:fix` to act on findings.

---

## Step 1 — Gather Current State

Before running any agent, collect the following automatically:

```bash
# TypeScript errors
tsc --noEmit 2>&1

# ESLint errors
npx eslint . --ext .ts,.tsx 2>&1 | head -100

# Git status (uncommitted changes)
git status --short

# Recent commits (last 10)
git log --oneline -10

# Running processes (is dev server up?)
# Check package.json for dev/start scripts
```

Also read:
- `.claude/context/PROJECT.md` — current phase and expected feature completeness
- `.claude/DIAGNOSTIC_REPORT.md` — known issues from prior sessions (if it exists)
- `backend/package.json` and root `package.json` — dependency versions

---

## Step 2 — Area-Specific Checks

### If diagnosing `backend`:
- Check all route files for missing auth guards
- Check all Prisma queries for user-scoped WHERE clauses
- Check all async functions for try/catch
- Check for any `console.log` statements (should use logger)
- Check for hardcoded secrets or credentials
- Check that all env vars used in code are documented
- Verify Prisma schema matches the migration history (no drift)

### If diagnosing `frontend` or `mobile`:
- Check for screens missing loading state, error state, or empty state
- Check for raw `fetch()` calls (should use data-fetching abstraction)
- Check for hardcoded colors (should use design system classes)
- Check for `any` types
- Check navigation for untyped route params
- Verify all screens referenced in navigation are implemented

### If diagnosing `database`:
- Check migration history for gaps or conflicts
- Check Prisma schema for missing indexes on foreign keys
- Check for models missing `userId` scope on queries (look at route handlers)
- Check `compliance_audit_log` (or equivalent) is being written on data access
- Check for any seed data left in production code paths

### If diagnosing `integrations`:
- Check that all credential retrieval goes through secrets manager (not DB)
- Check for rate limiting implementation on all external HTTP clients
- Check for retry logic on all external calls
- Check that sync workers are isolated from the main API process
- Check for PII in log statements within integration files

### If diagnosing `ai`:
- Check that all LLM calls have Zod validation schemas
- Check that all LLM calls have a fallback value
- Check for PII in prompt templates
- Check prompt version comments are present
- Check that AI features have Jest tests with mocked responses

### If diagnosing `devops`:
- Check `.github/workflows/` for missing test or lint steps
- Check that production deploy requires manual approval gate
- Check `.env.local.example` is up to date with all env vars in use
- Check that `.env` or `.env.local` is in `.gitignore`
- Verify monitoring (Sentry or equivalent) is configured with PII scrubbing

### If diagnosing `compliance`:
- Run the QA agent's compliance audit checklist against the codebase
- Check every data access for audit log writes
- Check COPPA/age-verification flows (if applicable)
- Check data deletion capability

---

## Step 3 — Produce Diagnostic Report

Format the report as follows and save to `.claude/DIAGNOSTIC_REPORT.md`:

```markdown
# Diagnostic Report — [Date]

## Summary
[2–3 sentence overall health assessment]

## Critical Issues (must fix before shipping anything)
- [ ] [Issue] — [file:line] — Recommended fix: [fix]

## High Priority (fix in current sprint)
- [ ] [Issue] — [file:line] — Recommended fix: [fix]

## Medium Priority (fix in next sprint)
- [ ] [Issue] — [file:line] — Recommended fix: [fix]

## Low Priority / Tech Debt
- [ ] [Issue] — [file:line]

## TypeScript Errors
[tsc --noEmit output, or "none"]

## ESLint Errors
[lint output summary, or "none"]

## Missing Context Files
[list any .claude/context/ files that are missing or need updating, or "none"]

## Environment Variables Status
[list vars that are required but appear unset, or "all present"]

## Integration Blockers
[list any known external service issues, or "none"]

## Recommended Next Steps
1. [highest priority action]
2. [second action]
3. [third action]
```

---

## Step 4 — Ask User What to Do Next

After producing the report, ask:

> "Diagnostic complete. I found [N] critical issues and [N] high-priority items.
>
> What would you like to tackle first?
> - I can run `/project:fix` on the critical issues
> - I can plan a sprint to address the high-priority items with `/project:sprint`
> - Or tell me which specific issue to start with"
