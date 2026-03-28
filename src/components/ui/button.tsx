import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-accent-rose/90 text-fg-primary border border-accent-rose/40 shadow-[inset_0_1px_0_rgba(193,198,196,0.08),0_1px_3px_rgba(0,0,0,0.3)] hover:bg-accent-rose hover:shadow-[inset_0_1px_0_rgba(193,198,196,0.12),0_2px_8px_rgba(125,61,82,0.25)] active:bg-accent-rose/80 active:shadow-none",
  secondary:
    "border border-glass-border bg-glass-highlight text-fg-primary backdrop-blur-sm hover:bg-bg-tertiary/60 hover:border-fg-muted/10 active:bg-bg-tertiary/80",
  ghost:
    "text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary active:bg-bg-tertiary/80",
  danger:
    "bg-accent-red/8 text-accent-red border border-accent-red/15 hover:bg-accent-red/15 active:bg-accent-red/20",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3.5 text-sm gap-2",
  lg: "h-9 px-4 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center rounded-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-rose focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:pointer-events-none disabled:opacity-40 ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
