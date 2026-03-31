---
name: plan-check
description: Validate current implementation against the plan. Reports what's done, in-progress, not started, and any drift.
allowed-tools: Read, Grep, Glob, Bash(find *), Bash(wc *)
effort: high
---

# Validate Implementation Against Plan

You are auditing the current codebase against the implementation plan.

## Context

- **Plan file**: `.claude/plans/implementation.md`
- **Source directory**: `src/`
- **Test directory**: `tests/`

## Steps

1. **Read the plan** in full from `.claude/plans/implementation.md`

2. **Scan the codebase** — for each phase and each checklist item in the plan:
   - Check if the relevant files exist (Glob for expected paths)
   - Check if the described functionality is actually implemented (Read key files, Grep for function names and types)
   - Don't just check file existence — verify the content matches what the plan describes

3. **Produce a status report** with this structure:

   ### Phase N: [Phase Name]
   For each checklist item, mark one of:
   - ✅ **Done** — implemented and matches plan
   - 🔨 **In Progress** — file exists but incomplete
   - ⬜ **Not Started** — no evidence of implementation
   - ⚠️ **Drift** — implementation exists but diverges from the plan (explain how)

4. **Summary** at the end:
   - Total items: done / in-progress / not started / drift
   - **Blockers**: items that are blocking other work
   - **Drift concerns**: anything that needs plan updates to match reality
   - **Suggested next steps**: what to work on next based on dependencies

## Rules

- Be precise — don't mark something as done if it's only partially there
- Check for structural matches, not just file existence (e.g., if the plan says "optimistic locking with version counter", grep for the version field)
- If you find code that isn't in the plan, note it under drift
- Keep the report concise — one line per checklist item, expand only on drift items
