---
name: study-ref
description: Study a reference project's architecture, patterns, and implementation details. Fetches the repo and reports findings relevant to SlackPoker.
argument-hint: [repo name or URL, e.g. "poker-ts" or "texasHoldem-ts" or "slack-poker-bot"]
allowed-tools: Bash(gh *), Bash(git *), Read, Grep, Glob, WebFetch
effort: high
---

# Study Reference Project

You are researching a reference project to extract patterns and lessons for SlackPoker.

## Context

- **Our plan**: `.claude/plans/implementation.md`
- **Reference repos** (from the plan):
  - `claudijo/poker-ts` — TypeScript engine, side pots, betting rounds
  - `eliraz-refael/texasHoldem-ts` — Branded types, immutable state machine
  - `CharlieHess/slack-poker-bot` — Slack poker UX, common pitfalls
  - `BeekeeperAlex/poker-engine` — Clean pot model
  - `ishikota/PyPokerEngine` — Event-driven architecture
  - `HenryRLee/PokerHandEvaluator` — Lookup-table hand evaluation algorithm

## Target

$ARGUMENTS

## Steps

### 1. Identify the Repo
Match `$ARGUMENTS` to one of the known reference repos, or treat it as a GitHub URL/org/repo.

### 2. Fetch and Explore
- Use `gh api` or `git clone --depth 1` to a temp directory to browse the repo
- Read the README, package.json/setup files
- Identify the core source files

### 3. Analyze Architecture
Focus on what's **relevant to SlackPoker**:

- **State management**: How do they model game state? Mutable or immutable?
- **Hand evaluation**: Algorithm used? Lookup tables? Brute force?
- **Side pots**: How are they calculated? Data structures used?
- **Betting rounds**: How is action validation done? Turn tracking?
- **Types**: What type system patterns are used? Branded types? Discriminated unions?
- **Testing**: How do they test poker logic? What edge cases do they cover?
- **Slack integration** (if applicable): Message patterns, rate limit handling, DM delivery

### 4. Report Findings

```
## Study: [repo name]

### Architecture Overview
[How the project is structured]

### Patterns to Adopt
1. [Pattern] — [how to apply in SlackPoker]

### Patterns to Avoid
1. [Pattern] — [why it's not right for us]

### Code Snippets Worth Studying
[Specific files/functions with file paths]

### Suggested Plan Updates
[Any changes to our implementation plan based on findings]
```

### 5. Clean Up
Remove any cloned repos from temp directories.

## Rules

- Focus on extractable patterns, not on copying code
- We build our own hand evaluator — study algorithms, don't import packages
- Compare findings against our current plan and flag conflicts
- Be specific: name files, functions, line numbers in the reference repo
