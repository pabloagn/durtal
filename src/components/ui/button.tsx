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
    "border border-glass-border bg-glass-highlight text-fg-primary hover:bg-bg-tertiary/60 hover:border-fg-muted/10 active:bg-bg-tertiary/80",
  ghost:
    "text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary active:bg-bg-tertiary/80",
  danger:
    "bg-accent-red/8 text-accent-red-text border border-accent-red/15 hover:bg-accent-red/15 active:bg-accent-red/20",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3.5 text-sm gap-2",
  lg: "h-9 px-4 text-sm gap-2",
};

/** On a touch screen every button is at least 44 x 44 px (docs/03, Keyboard, touch and motion) */
const COARSE = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/** Button styles for a link that should look like a Button. */
export function buttonClass(variant: Variant = "secondary", size: Size = "md") {
  return `inline-flex items-center justify-center whitespace-nowrap rounded-sm font-medium transition-all duration-150 ${variantStyles[variant]} ${sizeStyles[size]} ${COARSE}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        // Keyboard shortcuts find a dialog's main button by this mark
        data-variant={variant}
        // A label never wraps: a narrow row wraps whole buttons instead
        className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-40 ${variantStyles[variant]} ${sizeStyles[size]} ${COARSE} ${className}`}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
