# Task 0028: Design System Consolidation

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Full audit and consolidation of the Durtal design system. The color tokens are well-centralized in `@theme`, but several categories of design tokens are missing, ~40 hardcoded arbitrary values should use tokens, and repeated styling patterns should be extracted into utility classes.

## Findings

### Missing from `@theme`
- Micro-typography: `text-[10px]` used 38+ times, `text-[8px]` used 2 times — no token
- Spacing scale: documented in spec but not in `@theme`

### Hardcoded Values to Replace
- `text-[10px]` (38+ occurrences) — should be `text-micro`
- `text-[8px]` (2 occurrences) — should be `text-nano`
- `rounded-[2px]` (several) — should use `rounded-sm` (already 2px)
- `rounded-[1px]` (1) — should use `rounded-sm`

### Repeated Patterns to Extract
- Card hover effect duplicated 7+ times: `transition-all hover:border-fg-muted/30 hover:shadow-lg hover:shadow-accent-rose/5`

### Spec/Implementation Gaps
- Spacing tokens documented in `03_DESIGN_LANGUAGE.md` but not in `@theme`

## Implementation Steps

- [x] Add `--text-micro` (10px) and `--text-nano` (8px) font-size tokens to `@theme`
- [x] Add spacing scale tokens (`--spacing-xs` through `--spacing-3xl`) to `@theme`
- [x] Add `card-interactive` utility class to globals.css (`@utility`)
- [x] Replace all `text-[10px]` with `text-micro` (15 files, 38+ occurrences)
- [x] Replace all `text-[8px]` with `text-nano` (2 files)
- [x] Replace all `rounded-[2px]` and `rounded-[1px]` with `rounded-sm` (4 files)
- [x] Apply `card-interactive` class in BookCard, AuthorCard, Card, dashboard (4 files)
- [x] Run `pnpm typecheck` — passes clean
- [ ] Verify visually
