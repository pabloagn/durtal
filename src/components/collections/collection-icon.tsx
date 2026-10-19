import type { ReactNode } from "react";
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

/** The icon beside a collection card's name, or nothing */
export function collectionCardIcon(icon: string | null | undefined): ReactNode {
  return icon ? <CollectionIcon icon={icon} className="block h-4 w-4 text-fg-secondary" /> : null;
}
