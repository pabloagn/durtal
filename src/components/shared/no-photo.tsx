import { FadeImage } from "@/components/shared/fade-image";

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

/** Up to three of the subject's book covers, fanned like books on a table */
const FAN = {
  1: [{ x: 0, r: 0 }],
  2: [
    { x: -17, r: -5 },
    { x: 17, r: 5 },
  ],
  3: [
    { x: -24, r: -8 },
    { x: 24, r: 8 },
    { x: 0, r: 0 },
  ],
} as const;

/** One cover alone is larger; a fan of three is narrower, to stay inside */
const WIDTH = { 1: "w-[52%]", 2: "w-[46%]", 3: "w-[42%]" } as const;

export function CoverFan({ covers }: { covers: string[] }) {
  const shown = covers.slice(0, 3);
  const layout = FAN[shown.length as 1 | 2 | 3];
  if (!layout) return null;
  // The middle cover sits on top: it is drawn last
  const order = shown.length === 3 ? [shown[1], shown[2], shown[0]] : shown;
  return (
    <div className="absolute inset-0" aria-hidden>
      {layout.map(({ x, r }, i) => (
        <div
          key={order[i]}
          className={`absolute left-1/2 top-1/2 aspect-[2/3] ${WIDTH[shown.length as 1 | 2 | 3]} overflow-hidden bg-bg-secondary shadow-[0_8px_24px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.06]`}
          style={{ transform: `translate(-50%, -50%) translateX(${x}%) rotate(${r}deg)` }}
        >
          <FadeImage
            src={order[i]}
            alt=""
            loading="lazy"
            decoding="async"
            className="protected-image h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Initials in the serif on a tint taken from the name. Their line is trimmed
 * to the cap height and baseline, as a blank cover's letter is
 * (`CoverLetter`), so the frame centers the capitals themselves: the serif's
 * line box put them 4 to 5px above the middle, and letter spacing after the
 * last letter put them half a pixel left of it.
 */
export function Monogram({ name }: { name: string }) {
  const words = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : (words[0]?.slice(0, 1) ?? "?");
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={monogramTint(name)}
      aria-hidden
    >
      <span className="font-serif text-4xl leading-none text-fg-secondary [text-box:trim-both_cap_alphabetic]">
        {initials.toUpperCase()}
      </span>
    </div>
  );
}
