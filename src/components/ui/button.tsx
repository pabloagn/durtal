import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-accent-rose text-fg-primary hover:bg-accent-rose/80 active:bg-accent-rose/70",
  secondary:
    "border border-bg-tertiary bg-bg-secondary text-fg-primary hover:bg-bg-tertiary active:bg-bg-tertiary/80",
  ghost:
    "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary active:bg-bg-tertiary/80",
  danger:
    "bg-accent-red/10 text-accent-red border border-accent-red/20 hover:bg-accent-red/20 active:bg-accent-red/30",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  lg: "h-9 px-4 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-rose disabled:pointer-events-none disabled:opacity-50 ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
