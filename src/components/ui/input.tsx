import { forwardRef, useId, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id: idProp, ...props }, ref) => {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const errorId = `${id}-error`;
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
          aria-describedby={error ? errorId : undefined}
          className={`h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-sm text-fg-primary placeholder:text-fg-muted transition-all duration-150 focus:border-accent-rose focus:outline-none focus:glass-input-focus disabled:cursor-not-allowed disabled:opacity-40 ${
            error ? "border-accent-red" : ""
          } ${className}`}
          {...props}
        />
        {error && <p id={errorId} className="text-xs text-accent-red">{error}</p>}
      </div>
    );
  },
);

Input.displayName = "Input";
