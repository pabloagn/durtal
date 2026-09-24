import { forwardRef, useId, type TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
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
        <textarea
          ref={ref}
          id={id}
          aria-describedby={error ? errorId : undefined}
          className={`min-h-[80px] w-full rounded-sm border border-glass-border bg-bg-primary px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
            error ? "border-accent-red" : ""
          } ${className}`}
          {...props}
        />
        {error && <p id={errorId} className="text-xs text-accent-red">{error}</p>}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";
