# Task 0035: Dropdown Menu UI Component

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0036, 0038

## Overview

The component library currently has no dropdown menu or context menu primitive. One is required before any actions menu can be built on book cards. Build a reusable `DropdownMenu` component in `src/components/ui/dropdown-menu.tsx` that matches the project's gothic-minimal design language.

This is a foundational UI primitive -- every subsequent card-level action depends on it.

## Implementation Details

### Component API

```typescript
interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "center" | "end";   // horizontal alignment relative to trigger
  side?: "top" | "bottom";              // vertical placement
  open?: boolean;                        // controlled mode
  onOpenChange?: (open: boolean) => void;
}

interface DropdownMenuItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";        // danger = red text for destructive actions
  icon?: React.ReactNode;               // optional leading icon (Lucide, 16px)
}

interface DropdownMenuSeparatorProps {}

interface DropdownMenuLabelProps {
  children: React.ReactNode;
}
```

Exports: `DropdownMenu`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuLabel`.

### Behavior

- Trigger click toggles the menu open/closed
- Click outside closes the menu
- `Escape` key closes the menu
- Arrow Up / Arrow Down navigates items
- `Enter` activates the focused item
- Focus is trapped inside the menu while open
- Menu is portalled to `document.body` to avoid overflow clipping (book cards have `overflow-hidden`)
- Position is computed relative to trigger (use a simple absolute-positioning approach or a lightweight popper)

### Styling (must match design language)

- Background: `bg-bg-secondary` (same as cards)
- Border: `1px solid` using `border-glass-border`
- Border radius: `2px` (project default, squared)
- Shadow: subtle `shadow-lg` with very low opacity
- Font: Inter (sans body), `text-sm`
- Items: `px-3 py-2`, hover state `bg-bg-tertiary`
- Danger variant: `text-red-400` with `hover:bg-red-950/30`
- Separator: `border-t border-glass-border my-1`
- Label: `px-3 py-1.5 text-xs text-text-tertiary uppercase tracking-wider`
- Min width: `180px`
- Animation: fade + slight translate-y on open (CSS transition, no library needed)

### Files

| File | Change |
|---|---|
| `src/components/ui/dropdown-menu.tsx` | New: full dropdown menu component |

## Completion Notes

Implemented `src/components/ui/dropdown-menu.tsx` with four exports:
- `DropdownMenu` -- root component with trigger, align, side, controlled/uncontrolled open state
- `DropdownMenuItem` -- with icon, variant (default/danger), disabled support
- `DropdownMenuSeparator` -- thin border separator
- `DropdownMenuLabel` -- uppercase section label

Features: outside-click close, Escape close, Arrow Up/Down/Home/End navigation, Enter/Space activation, auto-focus first item on open, context-based close propagation. Styled to match project design language (bg-bg-secondary, glass-border, 2px radius, shadow).
