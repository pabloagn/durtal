# Task 0810: The media manager asks before losing unsaved adjustments, and keeps the focus

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-901 and SLN-902, from the image editor and media manager survey (`findings/media-editor-survey-2026-10-16.md`, items 1 and 2).
- Escape, Close and Done on Manage media threw away unsaved adjustments without asking, and so did picking another poster or tab. The Adjust image dialog opened from a thumbnail already asked.
- The focus dropped to the page in four places: after Save in the manager's editor, which also reopened on Tone; after Set active; after Escape on the delete confirm; after Discard in the nested Adjust image dialog.
- While one Set active saved, another thumbnail could start a second.

## Implementation Details
- `image-adjustment-editor.tsx`:
  - The editor reports its unsaved work to its owner (`onDraft`), with a save that resolves true once stored.
  - Save sits outside the locked fieldset, so it keeps the focus while it saves (busy, never disabled). Once saved it has nothing to save and turns off, so the focus goes to the open group's first slider.
  - When the owner hands back the file the editor's own save wrote, the editor stays open as it is, on the same group, and only its picture of the stored image is reloaded.
- `image-details-editor.tsx`: reports its unsaved details the same way. After its own Save the focus goes to its first field once the button turns off.
- `media-manager-dialog.tsx`:
  - The dialog's `dirty` is the editors' unsaved work, so Escape, Close and Done ask Save, Discard or Keep editing. Save saves both editors, then closes.
  - Picking another poster, gallery image or tab asks first: "Save your changes first?". Save saves and then switches; Discard switches.
  - A refresh after a change keeps the editors mounted (no spinner); only a tab's first load shows it.
  - The active thumbnail, and every thumbnail while one is being set, reads as off (`aria-disabled`) but keeps the focus. A second Set active while one runs does nothing.
- `surface-state.ts` (`restoreFocusOrigin`): when a dialog over another one closes (a confirm, a nested editor, an unsaved-changes question), the focus goes back to the control in the dialog under it that opened it. Before, nothing restored it while a surface was still open.
- `unsaved-guard.ts`, `dialog.tsx`: the unsaved-changes question can carry its own wording (`question`).

## Completion Notes
- Test: `src/__tests__/ui/media-keeps-work.test.ts` (6 of its 7 tests fail without the fix).
- Checked on a disposable preview (`scripts/qa/preview-local.py`), never the shared one; see the PR.
