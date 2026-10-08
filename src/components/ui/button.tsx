import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary: "bg-action-fill text-action-fg hover:bg-action-hover active:bg-action-fill/90 aria-expanded:bg-action-hover",
  secondary: "bg-glass-highlight text-fg-primary hover:bg-bg-tertiary active:bg-bg-tertiary/80 aria-expanded:bg-bg-tertiary",
  ghost: "action-ghost",
  danger: "bg-accent-red/8 text-accent-red-text hover:bg-accent-red/15 active:bg-accent-red/20",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-xs gap-1.5",
  lg: "h-9 px-3.5 text-xs gap-1.5",
};

/** On a touch screen every button is at least 44 x 44 px (docs/03, Keyboard, touch and motion) */
const COARSE = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";
const BASE = "action-control whitespace-nowrap font-medium [&>svg]:size-4 [&>svg]:shrink-0";

/** Button styles for a link that should look like a Button. */
export function buttonClass(variant: Variant = "secondary", size: Size = "md") {
  return `${BASE} ${variantStyles[variant]} ${sizeStyles[size]} ${COARSE}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        // Keyboard shortcuts find a dialog's main button by this mark
        data-variant={variant}
        // A label never wraps: a narrow row wraps whole buttons instead
        className={`${buttonClass(variant, size)} ${className}`}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
