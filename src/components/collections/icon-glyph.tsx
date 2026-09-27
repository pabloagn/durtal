"use client";

import { icons, type LucideProps } from "lucide-react";

/** Client renderer for a Lucide icon by name; load it lazily (it holds the whole set). */
export default function IconGlyph({
  icon,
  ...props
}: { icon: string } & LucideProps) {
  const Glyph = Object.hasOwn(icons, icon)
    ? icons[icon as keyof typeof icons]
    : null;
  return Glyph ? (
    <Glyph strokeWidth={1.5} aria-hidden="true" {...props} />
  ) : null;
}
