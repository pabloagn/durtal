type Variant = "default" | "accent" | "gold" | "sage" | "blue" | "red" | "muted";

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

/** One class per variant (`badge-*` in globals.css): a grid repeats them on every card (page weight) */
const variantStyles: Record<Variant, string> = {
  default: "badge-default",
  accent: "badge-accent",
  gold: "badge-gold",
  sage: "badge-sage",
  blue: "badge-blue",
  red: "badge-red",
  muted: "badge-muted",
};

export function Badge({
  variant = "default",
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
