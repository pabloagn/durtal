# Task 0107: Accessibility Audit Fixes

**Status**: Completed
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0097
**Blocks**: None

## Overview
Systematic accessibility gaps identified across UI components and pages. No WCAG 2.1 AA compliance currently.

## Implementation Details
### UI Components
- **Spinner** (`src/components/ui/spinner.tsx`): Add `role="status"` and `aria-label="Loading"`; fix stroke-width from 2px to 1.5px per design language
- **Slider** (`src/components/ui/slider.tsx`): Add `role="slider"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`
- **RangeSlider** (`src/components/ui/range-slider.tsx`): Same ARIA attributes for both thumbs
- **Input/Textarea** (`src/components/ui/input.tsx`, `textarea.tsx`): Add `aria-describedby` linking error message to input
- **RichTextEditor** (`src/components/shared/rich-text-editor.tsx`): Replace `window.prompt()` for link insertion with an accessible dialog; add `aria-label` to contenteditable div

### Layout
- **Sidebar** (`src/components/layout/sidebar.tsx`): Add `aria-label` to resize handle; add keyboard resize support (arrow keys)
- **Shell**: Add skip-to-content link

### Pages
- Add `alt` text to all images (author posters, book covers, venue images)
- Add `aria-current="page"` to pagination controls
- Tags page: Color dots need text labels (WCAG color-only indicator violation)
- `dangerouslySetInnerHTML` in author/work bios: Sanitize with DOMPurify or similar

### Data Components
- **DataTable** (`src/components/shared/data-table.tsx`): Add `aria-sort` to sortable headers
- **HorizontalCarousel**: Add `aria-label` to scroll buttons
