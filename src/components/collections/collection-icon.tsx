import { icons, type LucideProps } from "lucide-react";

/**
 * A collection's Lucide icon, rendered on the server. This module imports the
 * whole icon set, so only server components may use it. Client components use
 * `CollectionIconLazy`, which loads the set on demand.
 */
export function CollectionIcon({
  icon,
  ...props
}: { icon: string | null | undefined } & LucideProps) {
  const Glyph =
    icon && Object.hasOwn(icons, icon)
      ? icons[icon as keyof typeof icons]
      : null;
  if (!Glyph) return null;
  return <Glyph strokeWidth={1.5} aria-hidden="true" {...props} />;
}
