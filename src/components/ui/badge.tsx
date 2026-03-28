type Variant = "default" | "rose" | "gold" | "sage" | "blue" | "red" | "muted";

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<Variant, string> = {
  default: "bg-bg-tertiary text-fg-secondary",
  rose: "bg-accent-rose/15 text-accent-rose",
  gold: "bg-accent-gold/15 text-accent-gold",
  sage: "bg-accent-sage/15 text-accent-sage",
  blue: "bg-accent-blue/15 text-accent-blue",
  red: "bg-accent-red/15 text-accent-red",
  muted: "bg-bg-tertiary text-fg-muted",
};

export function Badge({
  variant = "default",
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
