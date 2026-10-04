# Task 0259: React Hooks and Next Lint Rules (SLN-308, lint part)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: None
**Blocks**: None

## Overview
`pnpm lint` ran only the `typescript-eslint` recommended rules. It reported no
React hooks or Next.js problems. This task adds both rule sets. The Prettier
part of SLN-308 waits until the open branches land.

## Implementation Details
- Dev dependencies: `eslint-plugin-react-hooks` 7.0.1 and
  `@next/eslint-plugin-next` 16.2.1. Both were already in the lockfile through
  `eslint-config-next`, so no new package versions were downloaded.
- `eslint.config.mjs`: the hooks plugin's `recommended-latest` rules and the
  Next plugin's `recommended` and `core-web-vitals` rules apply to `src/`.
- `eslint-config-next/core-web-vitals` was not used: its
  `eslint-plugin-react` 7.37 crashes on ESLint 10.
- The React Compiler rules (`set-state-in-effect`, `refs`,
  `static-components` and the rest) warn instead of fail. They report 30
  places in 26 files, and open pull requests change 11 of those files.
  `rules-of-hooks` and the Next rules that are errors stay errors.
- `docs/12_DEVELOPMENT.md`: the ESLint section names the rule sets.

## Completion Notes
`pnpm lint`: 0 errors, 68 warnings (30 React Compiler, 4 `exhaustive-deps`,
34 `no-img-element`). Before this task it had 0 problems because no rule
looked for them.

Follow-up: fix the 30 React Compiler warnings and turn those rules into
errors once the open pull requests on the same files land. The 4
`exhaustive-deps` warnings need a look one by one: adding the missing
dependencies would rerun those effects (for example, the EPUB reader would
load the book again on each settings change).
