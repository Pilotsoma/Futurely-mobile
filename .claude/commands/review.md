# /project:review — Code, Security & Compliance Review

## Usage
```
/project:review
/project:review [area: security | compliance | code | ai | performance | all]
/project:review PR   (review the current branch diff vs main)
/project:review [specific file or module path]
```

Examples:
- `/project:review` (full review of recent changes)
- `/project:review security` (security-focused review only)
- `/project:review compliance` (COMPLIANCE.md audit only)
- `/project:review PR` (review changes on this branch before opening a PR)
- `/project:review backend/src/routes/grades.ts`

---

## What This Command Does

Invokes the `qa-engineer` (and optionally the `architect`) to perform a structured review.
Produces a prioritized findings report with verdicts and fix instructions.
Does NOT make code changes — review only. Use `/project:fix` to act on findings.

---

## Step 0 — Determine Review Scope

If $ARGUMENTS is empty:
> "What should I review?
> - `security` — auth, data isolation, credential handling, injection vulnerabilities
> - `compliance` — FERPA/COPPA audit, data access logging, consent flows
> - `code` — engineering rules, TypeScript hygiene, dead code, anti-patterns
> - `ai` — prompt safety, schema validation, PII in prompts, fallback logic
> - `performance` — query efficiency, N+1 problems, caching, mobile render cost
> - `PR` — diff of current branch vs main
> - `all` — full review (takes longer)
> - or paste a file path for a focused review"

If $ARGUMENTS is provided, use it directly.

---

## Step 1 — Gather Review Target

### If reviewing `PR` or recent changes:
```bash
git diff main...HEAD --stat        # see which files changed
git diff main...HEAD               # full diff
git log main..HEAD --oneline       # commits on this branch
```

### If reviewing a specific file:
Read the file and its direct imports/dependencies.

### If reviewing `all` or a broad area:
Systematically read the relevant source directories based on the area:
- `security` → all route files, middleware, auth logic
- `compliance` → all data access code, audit log writes, consent flow
- `code` → all TypeScript source files (sample large codebases, don't read every file)
- `ai` → all prompt templates, LLM call sites, validation schemas
- `performance` → all API routes, Prisma queries, component render logic

---

## Step 2 — Invoke QA Engineer

Invoke the `qa-engineer` subagent with:

```
Perform a [area] review of the following code:
[paste file contents or diff]

Context:
- COMPLIANCE.md requirements
- ENGINEERING_RULES.md standards
- ARCHITECTURE.md module boundaries

Focus areas for this review:
[list based on $ARGUMENTS]

Produce:
1. Findings list (Critical / High / Medium / Low severity)
2. Each finding: file:line, description, required fix
3. Overall verdict: PASS | REVISE | BLOCK
4. If BLOCK: which specific compliance or security rule is violated
```

---

## Step 3 — Architect Review (for BLOCK verdicts or design issues)

If the QA engineer issues a BLOCK verdict, or if the review surfaces a design-level issue (module boundary violation, wrong layer for logic), invoke the `architect` subagent:

```
Code review escalation:

QA findings:
[paste QA output]

Questions for Architect:
[list specific design or compliance questions]

Provide:
1. Ruling on each finding (is it a real violation or acceptable with justification?)
2. For BLOCK: exact steps to remediate before this can ship
3. If design issue: preferred solution and which agent should implement it
```

---

## Step 4 — Produce Review Report

Format the output as a structured findings report:

```markdown
## Code Review Report — [Date]
## Scope: [area reviewed] | [files or PR]
## Verdict: [PASS | REVISE | BLOCK]

---

### Critical Findings (BLOCK — do not ship until resolved)
- **[File:line]** — [Issue description]
  - Rule violated: [ENGINEERING_RULES.md section / COMPLIANCE.md section]
  - Required fix: [specific fix]
  - Agent to fix: [agent-name]

### High Severity (REVISE — fix before merging)
- **[File:line]** — [Issue description]
  - Required fix: [specific fix]
  - Agent to fix: [agent-name]

### Medium Severity (fix this sprint)
- **[File:line]** — [Issue description]
  - Suggested fix: [fix]

### Low Severity / Tech Debt
- **[File:line]** — [Issue description]

### Security Checklist Results
- [ ] Auth guards on all user-data endpoints
- [ ] Data isolation (no cross-user access)
- [ ] Input validation on all endpoints
- [ ] No secrets in source code
- [ ] No PII in logs or error messages
- [status for each]

### Compliance Checklist Results
- [ ] Compliance audit log written for all data access
- [ ] No PII in prompts (AI features)
- [ ] Consent verified before data processing (if applicable)
- [ ] Data deletion implemented (if applicable)
- [status for each]

### Positive Findings
[Note patterns done well — helps reinforce good practices]

---

### Next Steps
1. [highest-priority action]
2. [second action]
3. Run `/project:fix [issue]` to address findings
```

---

## Step 5 — Follow-Up

After presenting the report, ask:
> "Would you like me to fix any of these findings now?
> I can run `/project:fix` on the critical and high-severity items,
> or work through them in a sprint with `/project:sprint`."
