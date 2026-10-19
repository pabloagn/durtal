# Task 0836: The icon set leaves /collections

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1105, from findings/client-bundle-survey-2026-10-18.md (item 3). /collections' view is a client component, and it imported the collection card, which imported `collection-icon.tsx`, which imports the whole Lucide set to draw one icon by name. The set (about 580 KB raw) was in the page's first load.

## Implementation Details

- `collection-card.tsx` no longer imports the icon. It takes `icon`, a node drawn on the server, and hands it to `CardHeading` as before.
- `collection-icon.tsx` adds `collectionCardIcon(name)`: the card's 16px icon in `fg-secondary`, or nothing.
- The callers draw it: the dashboard (`(catalogue)/page.tsx`) and `work-collections.tsx` (book, film, perfume and painting pages) pass it to the card; `collections/page.tsx` sends it to `CollectionsView` with each card's covers, and the view passes it on. The icon is server-rendered SVG, as before, so nothing loads or shifts after the page.
- `CollectionIconLazy` stays for client uses that pick an icon.

## Completion Notes

/collections' first-load JS, from `.next/diagnostics/route-bundle-stats.json` gzipped at level 6: 508.7 KB before, 363.8 KB after (1,895 KB to 1,274 KB raw). The dashboard, a book page and a collection page are unchanged. The icons show at 16px on /collections, the dashboard and a book page in Chromium, Firefox and WebKit at 1440 and 390. Alignment, design, overflow, layout and touch audits are clean on those pages at 1440, 390 and 320 (seeded with four collections: long and short names, with and without a description and an icon), and page weight passes. A source test pins that the card never imports the icon set.
