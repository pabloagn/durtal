import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/**
 * A glass surface: the one material for whatever floats above the page
 * (palette, menus, popovers, toolbars). See the `glass` and `glass-bar`
 * utilities in `globals.css` and "Glass" in `docs/03_DESIGN_LANGUAGE.md`.
 *
 * - `panel` (default): a floating panel with 4px corners, a hairline lit edge
 *   and a soft shadow. Positioned `relative` unless `className` sets
 *   `absolute` or `fixed`.
 * - `bar`: a bar fixed to a screen edge: square corners, no shadow; add the
 *   border on the side that faces the page.
 *
 * Elements that cannot be wrapped (a native `<dialog>`, a cmdk list) take
 * the `glass` class directly.
 */
export function Glass<T extends ElementType = "div">({
  as,
  variant = "panel",
  className = "",
  children,
  ...rest
}: {
  as?: T;
  variant?: "panel" | "bar";
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">) {
  const Tag: ElementType = as ?? "div";
  const positioned = /\b(absolute|fixed|sticky)\b/.test(className);
  return (
    <Tag
      className={`${variant === "bar" ? "glass-bar" : "glass"} ${positioned ? "" : "relative"} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
