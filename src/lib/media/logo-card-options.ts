/**
 * A logo card's switches (SLN-441), safe for the browser: the dialog reads and
 * sends them; `logo-card.ts` (server only, sharp) applies them.
 */

export interface LogoCardOptions {
  /** Swap ink and cut-outs: for a logo whose shape is the empty part */
  invert?: boolean;
  /** Keep the logo's own colours instead of one light ink */
  keepColours?: boolean;
  /** Keep only the emblem: the largest shape and what lies inside it */
  emblemOnly?: boolean;
  /** -1 slightly smaller, 0 as is, 1 slightly bigger */
  size?: -1 | 0 | 1;
  /** A disc-shaped logo: show what is drawn inside the disc, not the disc */
  badge?: boolean;
}

/** The switches, read from a form or a stored row; unknown values are dropped */
export function parseLogoCardOptions(raw: unknown): LogoCardOptions {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    invert: o.invert === true,
    keepColours: o.keepColours === true,
    emblemOnly: o.emblemOnly === true,
    badge: o.badge === true,
    size: o.size === 1 || o.size === -1 ? o.size : 0,
  };
}

/** Whether a stored image is a logo card (its processing params say so) */
export function isLogoCard(processingParams: unknown): boolean {
  return (
    typeof processingParams === "object" &&
    processingParams !== null &&
    "logoCard" in processingParams
  );
}
