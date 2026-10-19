/**
 * A pager's Previous, Next and page buttons: outlined, 32px (44px on touch).
 * Shared by the list pager (pagination.tsx) and pagers drawn on the server,
 * such as Suggestions' (SLN-1195), which can't import a constant from a client
 * module.
 */
export const pagerControl =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-sm border border-glass-border px-2 text-xs text-fg-secondary hover:bg-bg-tertiary disabled:pointer-events-none disabled:opacity-60 pointer-coarse:h-11 pointer-coarse:min-w-11";
