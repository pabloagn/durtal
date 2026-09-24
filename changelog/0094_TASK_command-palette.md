# Task 0094: Command Palette Sync

**Status**: Completed
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
Sync the command palette navigation items with the current sidebar. The palette was missing Places, Provenance, and Subjects routes added after its initial implementation. Also corrected the Locations icon from MapPin to Archive to match the sidebar.

## Implementation Details
- Updated `src/components/layout/command-palette.tsx`
- Added Places (MapPin), Provenance (Route), Subjects (Bookmark) to NAVIGATION_ITEMS
- Changed Locations icon from MapPin to Archive to match sidebar
- Imported Archive, Route, Bookmark from lucide-react

## Completion Notes
Command palette now has full parity with sidebar navigation (12 items).
