/**
 * What a card shows when its subject has no photo. One family, so the author,
 * place and series grids look related: the `bg-tertiary` frame, a dim tone,
 * serif type in `fg-secondary`/`fg-primary`, and nothing brighter than a
 * cover. Each piece fills its frame (the card's aspect-ratio box).
 */

const TONES = [
  "--color-accent-primary",
  "--color-accent-slate",
  "--color-accent-gold",
  "--color-accent-sage",
  "--color-accent-blue",
  "--color-selection-bg",
] as const;

/**
 * A token mixed into the darkest card color: a tint, not a color block. The
 * dark base keeps `fg-secondary` text above 4.5:1 up to 10%, and above 4:1 at
 * 18%: enough for large text only. Small text on a stronger tint uses
 * `fg-primary` (9:1 or more at 18%).
 */
function tint(token: string, percent: number) {
  return {
    backgroundColor: `color-mix(in oklab, var(${token}) ${percent}%, var(--color-bg-secondary))`,
  };
}

/** A stable number from a string, for tones and spine heights */
function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The tint behind a subject's `Monogram`, for a small portrait elsewhere (the
 * timelines): the same author gets the same tone everywhere. A letter under
 * 24px on it is `fg-primary`.
 */
export function monogramTint(name: string) {
  return tint(TONES[hash(name) % TONES.length], 18);
}

export { CoverFan } from "./cover-fan";

/**
 * Initials in the serif on a tint taken from the name. Their line is trimmed
 * to the cap height and baseline, as a blank cover's letter is
 * (`CoverLetter`), so the frame centers the capitals themselves: the serif's
 * line box put them 4 to 5px above the middle, and letter spacing after the
 * last letter put them half a pixel left of it.
 *
 * The frame is the `monogram` size container, so the initials keep to the
 * type scale as it grows, as a blank cover's letter does: 12px in a list
 * row's thumbnail, 21px from 40px wide, 46px from 120px (a card). Under
 * 24px they are `fg-primary`, which the tint keeps above 4.5:1 (SLN-1066).
 */
export function Monogram({ name }: { name: string }) {
  const words = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : (words[0]?.slice(0, 1) ?? "?");
  return (
    <div
      className="@container/monogram absolute inset-0 flex items-center justify-center"
      style={monogramTint(name)}
      aria-hidden
    >
      <span className="font-serif text-micro leading-none text-fg-primary [text-box:trim-both_cap_alphabetic] @[40px]/monogram:text-lg @[120px]/monogram:text-4xl @[120px]/monogram:text-fg-secondary">
        {initials.toUpperCase()}
      </span>
    </div>
  );
}
