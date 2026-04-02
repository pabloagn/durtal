# Task 0048: Image Lightbox / Zoom on Click

**Status**: Completed
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: 0057

## Overview
When clicking on a poster image (book cover or author portrait) on a book detail page or author detail page, the image should expand into a lightbox overlay: the image is maximized (not full-screen, but as large as possible while maintaining aspect ratio and padding), and the background is dimmed with a dark overlay. Clicking the overlay or pressing Escape dismisses it.

This applies to:
- Book cover posters on the book detail page
- Author portrait posters on the author detail page
- Gallery images on both book and author detail pages (via Task 0057)

## Implementation Details
- Create a reusable `ImageLightbox` component (e.g., `src/components/shared/image-lightbox.tsx`)
- Animate the image scaling up from its resting position
- Dim background with a semi-transparent dark overlay (e.g., `bg-black/80`)
- Image should be centered, maximized with padding (not touching viewport edges)
- Close on overlay click, Escape key, or a subtle close button
- Maintain the dark-mode gothic-minimal aesthetic
- Cursor should indicate clickability on poster images (pointer)
- **No navigation arrows** -- this is a single-image viewer, not a carousel
- Posters are set exclusively via the Media menu, not from the lightbox
- The existing `media-gallery.tsx` has a basic lightbox with carousel -- this should be replaced or unified with the new component (removing carousel/navigation)
