"use client";

import { lazy, Suspense } from "react";
import type { LucideProps } from "lucide-react";

const IconGlyph = lazy(() => import("./icon-glyph"));

/**
 * A collection's icon in client components. The icon set loads on first use,
 * so pages that never show an icon do not download it. The empty box keeps the
 * layout steady while it loads.
 */
export function CollectionIconLazy({
  icon,
  className,
  ...props
}: { icon: string | null | undefined } & LucideProps) {
  if (!icon) return null;
  return (
    <Suspense fallback={<span className={className} aria-hidden="true" />}>
      <IconGlyph icon={icon} className={className} {...props} />
    </Suspense>
  );
}
