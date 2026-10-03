import { FadeImage } from "@/components/shared/fade-image";

/**
 * What a card shows when its subject has no photo. One family, so the author,
 * place and series grids look related: the `bg-tertiary` frame, a dim tone,
 * serif type in `fg-secondary`/`fg-primary`, and nothing brighter than a
 * cover. Each piece fills its frame (the card's aspect-ratio box).
 */

const TONES = [
  "--color-accent-rose",
  "--color-accent-slate",
  "--color-accent-gold",
  "--color-accent-sage",
  "--color-accent-blue",
  "--color-gothic-mulberry",
] as const;

/**
 * A token mixed into the darkest card color: a tint, not a color block. The
 * dark base keeps `fg-secondary` text above 4.5:1.
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

/** Initials in the serif on a tint taken from the name */
export function Monogram({ name }: { name: string }) {
  const words = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : (words[0]?.slice(0, 1) ?? "?");
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={tint(TONES[hash(name) % TONES.length], 18)}
      aria-hidden
    >
      <span className="font-serif text-4xl leading-none tracking-wide text-fg-secondary">
        {initials.toUpperCase()}
      </span>
    </div>
  );
}

const PLATE_TONES: Record<string, string> = {
  rose: "--color-accent-rose",
  gold: "--color-accent-gold",
  sage: "--color-accent-sage",
  blue: "--color-accent-blue",
  muted: "--color-accent-slate",
};

/**
 * A label for a place, like a drawer label: its kind and city in small
 * capitals, a rule, and its street in the serif ("Online" with no address)
 */
export function PlacePlate({
  kind,
  city,
  street,
  tone,
}: {
  kind: string;
  city: string | null;
  street: string | null;
  /** A badge variant (rose, gold, sage, blue, muted); none keeps the frame */
  tone?: string;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center"
      style={tone ? tint(PLATE_TONES[tone] ?? PLATE_TONES.muted, 12) : undefined}
      aria-hidden
    >
      <span className="type-caption">{city ? `${kind} · ${city}` : kind}</span>
      <span className="h-px w-8 bg-fg-muted" />
      <span className="lines-1 max-w-full font-serif text-lg text-fg-primary">
        {street ?? "Online"}
      </span>
    </div>
  );
}

/** A shelf of spines, one per volume of the series (three when unknown) */
export function ShelfSpines({ seed, volumes }: { seed: string; volumes: number | null }) {
  const count = Math.min(Math.max(volumes ?? 3, 1), 12);
  return (
    <div className="absolute inset-0" aria-hidden>
      {/* The shelf zone: spines stand on its bottom edge, 72-99% of its height */}
      <div className="absolute inset-x-0 bottom-[22%] top-[20%] flex items-end justify-center gap-1">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="w-[5%] max-w-4 rounded-[1px] ring-1 ring-white/[0.05]"
            style={{
              height: `${72 + (hash(`${seed}${i}`) % 28)}%`,
              ...tint("--color-fg-muted", 45),
            }}
          />
        ))}
      </div>
      <span className="absolute inset-x-[18%] bottom-[22%] h-px translate-y-full bg-fg-muted" />
    </div>
  );
}
