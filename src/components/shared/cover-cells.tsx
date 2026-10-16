"use client";

import { useState, type ReactNode } from "react";
import { FadeImage } from "@/components/shared/fade-image";

/**
 * A few covers side by side in one frame (a collection's or a series' card).
 * A cover that fails leaves its cell as the bare frame, so the others keep
 * their places; when every one fails the frame shows `fallback` instead (the
 * name's letter, a shelf of spines), as it does with no covers at all.
 */
export function CoverCells({
  srcs,
  className,
  cellClassNames,
  fallback,
}: {
  srcs: string[];
  /** The cells' container: a grid or a row filling the frame */
  className: string;
  /** Each cell's size and place, in the order of `srcs` (a list, not a function, so a server component can pass it) */
  cellClassNames: string[];
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  if (srcs.length && srcs.every((src) => failed.has(src))) return <>{fallback}</>;
  return (
    <div className={className}>
      {srcs.map((src, index) =>
        failed.has(src) ? (
          <span key={src} className={`bg-bg-tertiary ${cellClassNames[index]}`} />
        ) : (
          <FadeImage
            key={src}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className={cellClassNames[index]}
            onError={() => setFailed((prev) => new Set(prev).add(src))}
          />
        ),
      )}
    </div>
  );
}
