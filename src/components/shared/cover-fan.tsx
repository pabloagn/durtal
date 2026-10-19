"use client";

import { useState, type ReactNode } from "react";
import { FadeImage } from "@/components/shared/fade-image";

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

/**
 * A cover that fails leaves the fan, and the others close up around it; when
 * every one fails the fan shows `fallback` (the subject's initials or
 * letter), as it would with no covers (SLN-1066)
 */
export function CoverFan({ covers, fallback = null }: { covers: string[]; fallback?: ReactNode }) {
  const [failed, setFailed] = useState<string[]>([]);
  const shown = covers.filter((src) => !failed.includes(src)).slice(0, 3);
  const layout = FAN[shown.length as 1 | 2 | 3];
  if (!layout) return fallback;
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
            onError={() => setFailed((was) => (was.includes(order[i]) ? was : [...was, order[i]]))}
          />
        </div>
      ))}
    </div>
  );
}
