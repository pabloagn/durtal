type Variant = "default" | "accent" | "gold" | "sage" | "blue" | "red" | "muted";

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<Variant, string> = {
  default: "bg-bg-tertiary/60 text-fg-secondary border border-glass-border",
  accent: "bg-accent-primary/10 text-accent-primary border border-accent-primary/15",
  gold: "bg-accent-gold/10 text-accent-gold border border-accent-gold/15",
  sage: "bg-accent-sage/10 text-accent-sage border border-accent-sage/15",
  blue: "bg-accent-blue/10 text-accent-blue-text border border-accent-blue/15",
  red: "bg-accent-red/10 text-accent-red-text border border-accent-red/15",
  muted: "bg-bg-tertiary/40 text-fg-secondary border border-glass-border",
};

export function Badge({
  variant = "default",
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-micro tracking-wider ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
