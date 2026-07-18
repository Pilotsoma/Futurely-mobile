#!/usr/bin/env node
/**
 * Guardrail hook: PreToolUse for Edit|Write
 *
 * Purpose: prevent silent changes to existing, working, git-tracked code.
 *
 * Decision order:
 *   1. Path matches a "hard protected" glob (.claude/guardrails/protected-paths.json)
 *      -> always DENY. These are never editable through this hook; the user must
 *         change them by hand outside of an agent turn, or edit protected-paths.json
 *         to remove the entry if it's no longer needed.
 *   2. Path is not tracked by git (new file, doesn't exist yet, or is untracked)
 *      -> ALLOW. New code isn't "existing working functionality" yet.
 *   3. Path is tracked AND matches a glob in the current task's declared scope
 *      (.claude/guardrails/task-scope.json -> in_scope)
 *      -> ALLOW.
 *   4. Path is tracked and NOT in the declared scope
 *      -> ASK. Surfaces a normal permission prompt so the user consciously signs
 *         off before an existing file gets touched outside the stated task.
 *
 * Fail-safe: any unexpected error (git missing, bad JSON, etc.) resolves to ASK
 * rather than silently allowing or blocking everything.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (e) {
    return "";
  }
}

function output(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

function allow(reason) {
  output("allow", reason);
}
function deny(reason) {
  output("deny", reason);
}
function ask(reason) {
  output("ask", reason);
}

// --- glob matching (no deps): supports **, *, ? ---
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$", "i");
}

function matchesAny(relPath, globs) {
  const normalized = relPath.split(path.sep).join("/");
  return globs.some((g) => {
    if (!g) return false;
    const rx = globToRegExp(g.split(path.sep).join("/"));
    return rx.test(normalized);
  });
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch (e) {
    // Can't parse input at all -- don't guess, let the normal permission flow handle it.
    process.exit(0);
  }

  const toolName = input.tool_name;
  if (toolName !== "Edit" && toolName !== "Write") {
    process.exit(0);
  }

  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath) {
    process.exit(0);
  }

  const projectDir =
    process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

  let relPath;
  try {
    relPath = path.relative(projectDir, filePath);
  } catch (e) {
    return ask(
      "Guardrail hook could not resolve the file path relative to the project root; confirm this edit manually."
    );
  }

  // If the resolved path escapes the project dir entirely, don't guess.
  if (relPath.startsWith("..")) {
    return ask(
      `This edit targets a path outside the project (${filePath}). Confirm this is intentional.`
    );
  }

  const guardDir = path.join(projectDir, ".claude", "guardrails");
  const protectedPaths = loadJson(
    path.join(guardDir, "protected-paths.json"),
    { protected: [] }
  );
  const taskScope = loadJson(path.join(guardDir, "task-scope.json"), {
    in_scope: [],
  });

  const hardProtected = Array.isArray(protectedPaths.protected)
    ? protectedPaths.protected
    : [];
  const inScope = Array.isArray(taskScope.in_scope) ? taskScope.in_scope : [];

  // 1. Hard-protected paths -- always deny.
  if (matchesAny(relPath, hardProtected)) {
    return deny(
      `"${relPath}" is on the hard-protected list in .claude/guardrails/protected-paths.json. ` +
        `This path is never editable through an agent turn. If it genuinely needs to change, ` +
        `the user should edit it directly, or remove it from protected-paths.json first.`
    );
  }

  // 2. Untracked / new file -- allow.
  let isTracked = false;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", relPath], {
      cwd: projectDir,
      stdio: ["ignore", "ignore", "ignore"],
    });
    isTracked = true;
  } catch (e) {
    isTracked = false;
  }

  if (!isTracked) {
    return allow(
      `"${relPath}" is not tracked by git (new file) -- not existing functionality.`
    );
  }

  // 3. Tracked and in declared scope -- allow.
  if (matchesAny(relPath, inScope)) {
    return allow(
      `"${relPath}" matches the current task's declared scope in .claude/guardrails/task-scope.json.`
    );
  }

  // 4. Tracked, not in scope -- ask.
  return ask(
    `"${relPath}" is an existing, git-tracked file that is NOT part of the declared scope for this task ` +
      `(see .claude/guardrails/task-scope.json). Confirm you want to modify existing working functionality here. ` +
      `If this file IS part of the current task, add a matching glob to task-scope.json's "in_scope" array to stop asking.`
  );
}

try {
  main();
} catch (e) {
  ask(
    `Guardrail hook hit an unexpected error (${e && e.message}); confirm this edit manually.`
  );
}
