import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={id}
            className="block text-xs font-medium text-fg-secondary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={`h-8 w-full rounded-sm border border-bg-tertiary bg-bg-primary px-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
            error ? "border-accent-red" : ""
          } ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-accent-red">{error}</p>}
      </div>
    );
  },
);

Input.displayName = "Input";
