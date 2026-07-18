# Guardrail System

Read this before touching any file. This project enforces a technical guardrail — not
just a written rule — that stops any agent (main thread or subagent) from silently
modifying existing, working, git-tracked code.

The goal: nothing that already works should change unless the current task explicitly
says it should.

---

## How it works

A `PreToolUse` hook (`.claude/hooks/guard-protected-paths.js`, wired in
`.claude/settings.json`) intercepts every `Edit` and `Write` call before it runs and
resolves one of three outcomes:

1. **Deny** — the target path matches a glob in
   `.claude/guardrails/protected-paths.json`. These paths are never editable through an
   agent turn, full stop, regardless of task scope. Default list: env files, private
   keys/certs, lockfiles, applied Prisma migrations, `.git/`, and the guardrail config
   itself (`.claude/settings.json`, `.claude/hooks/**`,
   `.claude/guardrails/protected-paths.json`).
2. **Allow** — the target path is either (a) not tracked by git yet (a genuinely new
   file — not "existing functionality"), or (b) tracked and matches a glob in
   `.claude/guardrails/task-scope.json`'s `in_scope` list.
3. **Ask** — the target path is tracked by git and does **not** match the declared
   scope. The user sees a normal permission prompt and has to consciously approve the
   edit before it happens. This is the default state for every existing file, every
   session, until scope is declared.

If the hook itself errors for any reason (missing git, malformed JSON, etc.) it fails
toward **ask**, never toward silent allow or a blanket deny.

## Declaring scope for a task

Before editing existing files, update `.claude/guardrails/task-scope.json`:

```json
{
  "task": "add reminder notifications to the mobile app",
  "updated": "2026-07-05",
  "in_scope": [
    "nextstep-mobile/src/screens/**",
    "nextstep-mobile/src/services/notifications.ts",
    "backend/routes/reminders.ts"
  ]
}
```

Only list what the current task actually touches. Anything git-tracked outside that
list still gets an `ask` prompt — that's the point. When the task wraps up, clear
`in_scope` back to `[]` (or narrow it to the next task) so the next session starts from
a fully protected baseline rather than an accumulating allowlist.

This step is now part of the Session Start Protocol in the root `CLAUDE.md` — declare
scope right after answering "what are we doing today?"

## Adding or removing hard-protected paths

Edit `.claude/guardrails/protected-paths.json` directly (this file is itself
hard-protected, so an agent can't quietly loosen it — changing it requires the user's
explicit action outside a guarded edit). Patterns are glob-style, relative to the
project root, and support `*`, `**`, and `?`.

## What this does *not* cover

- It only gates `Edit` and `Write`. It does not gate `Bash` — a shell command can still
  overwrite a file directly. If you want that closed off too, a second `PreToolUse` hook
  matching `Bash` with an `if` filter on write-ish commands (`cp`, `mv`, `rm`, `>`,
  `sed -i`) would need to be added; it isn't in place yet because it's much easier to
  produce false positives (blocking a legitimate `npm install`, `git commit`, etc.).
- It does not verify the edit didn't *break* anything — this repo has no installed test
  runner or lint script (see `CLAUDE.md`'s Project-Specific Notes), so there's nothing to
  auto-run as a correctness gate yet. The `ask` prompt is a human checkpoint, not a
  correctness check.
- It's local to this machine/session config (`.claude/settings.json` is a project
  setting, so it *is* committed and shared — but a teammate could still disable it via
  `disableAllHooks` in their own `.claude/settings.local.json`).
