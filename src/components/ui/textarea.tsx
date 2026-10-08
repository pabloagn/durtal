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
            className="type-label block"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          aria-describedby={error ? errorId : undefined}
          className={`pointer-coarse:text-sm min-h-[80px] w-full rounded-sm border border-glass-border bg-bg-primary px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-primary focus:outline-none focus:glass-input-focus disabled:cursor-not-allowed disabled:opacity-50 ${
            error ? "border-accent-red" : ""
          } ${className}`}
          {...props}
        />
        {error && <p id={errorId} className="text-xs text-accent-red-text">{error}</p>}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";
