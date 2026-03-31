---
name: plan-refine
description: Deep-dive on a specific feature or phase from the plan. Investigates trade-offs, surfaces risks, and updates the plan.
argument-hint: [feature or phase name, e.g. "side pots" or "Phase 3"]
allowed-tools: Read, Grep, Glob, Edit, Bash(find *), Bash(wc *)
effort: high
---

# Investigate and Refine Plan

You are a senior engineer doing a deep-dive on a specific area of the implementation plan to ensure it's solid before (or during) development.

## Context

- **Plan file**: `.claude/plans/implementation.md`
- **PRD**: The original PRD requirements are reflected in the plan
- **Target area**: $ARGUMENTS

## Steps

### 1. Understand the Current Plan
- Read `.claude/plans/implementation.md` in full
- Identify all checklist items, design decisions, and open questions related to **$ARGUMENTS**

### 2. Investigate the Codebase
- Check what's already implemented for this area (Glob + Read)
- Review any related code that this area depends on or that depends on it
- Note any existing patterns or conventions that constrain the design

### 3. Analyze and Surface Issues

For the target area, evaluate:

- **Completeness**: Does the plan cover all PRD requirements for this feature? Any gaps?
- **Feasibility**: Are there technical risks or unknowns? Library limitations? Slack API constraints?
- **Dependencies**: What must exist before this can be built? What depends on this?
- **Edge cases**: What could go wrong? What's the failure mode?
- **Alternatives**: Are there simpler approaches we should consider?

### 4. Present Findings

Structure your findings as:

```
## Deep Dive: [area name]

### Current Plan
[Brief summary of what the plan says]

### What's Already Built
[Status of existing implementation, if any]

### Issues Found
1. [Issue] — [why it matters] — [suggested fix]

### Open Questions
- [Question that needs a decision before building]

### Proposed Plan Changes
[Specific edits to the plan, quoted with before/after]
```

### 5. Update the Plan (with approval)

- Present all proposed changes clearly before making them
- Wait for user confirmation before editing `.claude/plans/implementation.md`
- When editing, preserve the existing structure — only modify the relevant sections
- If a new open question emerges, add it to the Open Questions table at the bottom

## Rules

- Don't rubber-stamp the plan — actively look for problems
- Be specific: "this won't work because X" not "there might be issues"
- If $ARGUMENTS is vague, ask for clarification before proceeding
- Propose concrete plan edits, not abstract suggestions
- If you discover the area is solid, say so briefly — don't manufacture issues
