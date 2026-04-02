# Task 0054: Author Copy Button (Copy Full Name)

**Status**: Completed
**Created**: 2026-03-30
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0055
**Blocks**: None

## Overview
Add a copy-to-clipboard button for authors, similar to the existing copy functionality on book pages. For authors, the copied text should be the full name in "First Name Last Name" format.

## Implementation Details
- Add a "Copy" action to the author detail page action bar
- Copies "First Name Last Name" to clipboard
- Show a brief toast/notification confirming the copy
- Follow the same UX pattern as the book page copy button
- Include in both the author detail page header actions and the author card action menu
