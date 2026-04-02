# Task 0046: Author Monochrome Image Pipeline

**Status**: Completed
**Created**: 2026-03-29
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0044, 0045
**Blocks**: None

## Overview
Per-author configurable monochrome image preprocessing pipeline. When images are uploaded for authors, they are processed through a grayscale + normalization pipeline with tunable parameters (contrast, sharpness, gamma, brightness). The original color image is always preserved alongside the processed variant, enabling re-processing with different settings at any time.

## Implementation Details

### Schema Changes
- Added `original_s3_key` (TEXT, nullable) to `media` table — stores S3 key for the pre-processing color original
- Added `processing_params` (JSONB, nullable) to `media` table — stores monochrome tuning parameters

### Processing Parameters (per media item)
- `grayscale`: always `true` (enforced)
- `contrast`: 0.5–3.0 (default 1.0)
- `sharpness`: 0.0–5.0 (default 1.0)
- `gamma`: 0.5–3.0 (default 2.2)
- `brightness`: 0.5–2.0 (default 1.0)

### S3 Key Structure
- Original (color): `gold/media/author/{id}/{mediaType}/{fileId}_original.webp`
- Processed (mono): `gold/media/author/{id}/{mediaType}/{fileId}.webp`
- Thumbnail (mono): `gold/media/author/{id}/{mediaType}/{fileId}_thumb.webp`

### Core Functions
- `applyMonochromeProcessing()` — sharp pipeline: grayscale → gamma → contrast → brightness → sharpen
- `processAndUploadAuthorMedia()` — stores color original + creates monochrome variant
- `reprocessAuthorMedia()` — fetches original from S3, re-applies with new params

### API Routes
- Updated `/api/media/upload` — branches to author pipeline when entityType is "author"
- Updated `/api/media/from-url` — same branching
- Updated `/api/media/process` — same branching
- New `POST /api/media/reprocess-author` — re-process with new params
- New `GET /api/media/preview-monochrome` — ephemeral preview (no S3 write)

### UI Components
- New `Slider` component — design-language-consistent range input
- New `MonochromeControls` — four sliders + live preview + reset + apply
- New `AuthorMediaManagerDialog` — full media management with per-item tuning
- Updated `UploadZone` — accepts optional `processingParams`
- Updated `AuthorDetailHeader` — "Manage media" button
- Updated `AuthorMediaSection` — wired to new dialog

## Completion Notes
[To be filled on completion]
