# Task 0034: Add-Book Wizard -- Optional Instance & Catalogue Status

**Status**: In Progress
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0029
**Blocks**: None

## Overview

The add-book wizard currently forces users to create an instance (physical/digital copy with location) for every book added. This makes no sense for wishlist/tracking workflows. Users should be able to add books with statuses like "tracked", "shortlisted", or "wanted" without specifying a copy location -- similar to how Radarr/Sonarr handle media tracking.

Changes:
1. Add catalogue status selector to the Details step (currently hardcoded to "tracked")
2. Make the Instance step optional -- skip it entirely for non-owned statuses
3. Allow the Instance step to be skipped even for "accessioned" (user can add copies later from the detail page)
4. Update the submission logic to skip instance creation when no instances are configured
5. Update the Confirm step to reflect the new flow

## Implementation Details

### Details step
- Add a catalogue status selector (tracked, shortlisted, wanted, on_order, accessioned)
- Add an acquisition priority selector (none, low, medium, high, urgent)
- When status is "tracked"/"shortlisted"/"wanted", show a subtle note: "You can add copies later from the book detail page"

### Edition step
- After edition, the "next" button goes to Instance step BUT shows a "Skip -- I don't own this yet" button when status is not "accessioned"
- The edition step itself remains required (we always want metadata)

### Instance step
- Change header from "Add at least one copy" to context-aware text
- Add a prominent "Skip" button for non-owned statuses
- The "Categorize" button no longer requires an instance
- For "accessioned" status, instance is still recommended but skippable

### Submission
- Only create instances if `instanceDrafts` has entries with a `locationId`
- Use the user-selected `catalogueStatus` instead of hardcoded `"tracked"`

## Completion Notes

[Left empty]
