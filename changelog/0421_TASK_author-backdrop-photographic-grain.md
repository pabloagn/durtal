# Task 0421: Photographic grain on People backdrops

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-561 adds one restrained, non-destructive photographic grain treatment to People detail backdrops, including newly selected or uploaded images.

## Implementation Details

- The People route inserts a decorative, non-interactive texture between the existing image and readability scrim. The existing bottom gradient fades image and texture together.
- A route-local CSS module tunes intensity and fixes grain to CSS pixels independently of viewport size, device pixel ratio and image crop/zoom. Soft-light blending preserves tonal depth; the backdrop alone isolates its blending.
- A small static SVG uses deterministic, stitched, monochrome fractal noise. No animation, canvas, client loop, new dependency or media rewrite is added.
- Existing source selection, asset URLs, crop/position/zoom, brightness/contrast and monochrome processing remain unchanged. Poster/card/shared image helpers and other FullBleedLayer call sites are untouched.

## Completion Notes

Impact audit covered People, publisher and collection FullBleedLayer users, People poster/card rendering, image adjustment helpers and author monochrome processing. The supplied Primo Levi reference was inspected. Heavy validation and representative actual-app/browser evidence await the coordinator's serialized slot; no merge readiness is claimed.

Initial source validation: typecheck passes; lint passes with zero errors and 75 existing warnings; the full-bleed, media-style and media-crop focused suites pass 24/24 with zero skipped. The texture asset is 708 bytes.
