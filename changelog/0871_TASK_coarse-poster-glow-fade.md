# Task 0871: Fade the coarse poster glow within its bounds

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-975 reports a rectangular orange/brown halo around a book cover on a phone. The unblurred coarse-pointer PosterGlow uses gradients whose color extends to the edges of its finite box. This source condition matches the report; rendered layer isolation and physical-phone acceptance remain pending.

## Implementation Details

- Size each of PosterGlow's two coarse radial gradients with `ellipse closest-side` and fade to transparent at 100%. Each ellipse fits inside the existing halo box, including the offset secondary ellipse.
- Preserve both palette colors and opacities, centers, the 24px halo inset, cover dimensions, stacking, and noninteractive decoration.
- Keep the single unfiltered coarse plane and existing desktop gradients. No added mask, blur, animation, transform, or layer.
- The sole PosterGlow caller is WorkPosterImage on the book detail page's poster branch. Edition-cover and failed-image fallbacks remain unchanged.
- The separate AmbientCrystals field and People, publisher, and collection backdrops remain unchanged. A corresponding defect on those surfaces has not been reproduced; retain their crops, tone settings, grain, and containment.

## Completion Notes

Source-only checkpoint from main `6eb3cbb9c11afacc3c1c95e3f2826869aad40501`. No tests, typecheck, build, browser session, or database operation ran for this change. No runtime performance or visual acceptance is claimed.

Pending: isolate the reported edge before/after, inspect saturated/light/dark/missing-image cases at 320/390/430px plus tablet and desktop in Chromium, Firefox, and WebKit, and check actual alternate backdrop callers. Run existing resource/crop tests and required typecheck, local suites, alignment (0.5px), design, overflow, and page-weight checks under a later grant. Physical iPhone review remains required; desktop WebKit cannot establish that acceptance.
