import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** A line under the field, such as the format it takes; an error takes its place */
  hint?: string;
  /** A small button inside the field, at its right end */
  suffix?: ReactNode;
  /** Open fields for lightweight creation/edit forms. */
  appearance?: "default" | "open";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, suffix, appearance = "default", className = "", id: idProp, ...props }, ref) => {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;
    const showHint = hint && !error;
    const describedBy = [error ? errorId : showHint ? hintId : null, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
    const field = (
      <input
        ref={ref}
        id={id}
        className={`h-8 rounded-sm border text-fg-primary placeholder:text-fg-muted transition-colors duration-150 focus:border-accent-primary focus:outline-none focus:glass-input-focus disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:h-11 ${
          error ? "border-accent-red" : ""
        } ${suffix ? "pr-8 pointer-coarse:pr-12" : ""} ${
          // An open field's text keeps the column's edge, with room inside
          // its focus ring: the ring reaches 8px past the column, and the
          // padding gives way to the 1px border so the text starts on it
          appearance === "open"
            ? "input-open -mx-2 w-[calc(100%+1rem)] px-[calc(0.5rem-1px)] text-lg"
            : "w-full border-glass-border bg-bg-primary/80 px-3 text-xs pointer-coarse:text-sm"
        } ${className}`}
        {...props}
        aria-describedby={describedBy}
      />
    );
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
        {suffix ? (
          <div className="relative" data-field="">
            {field}
            <div className="absolute inset-y-0 right-1 flex items-center pointer-coarse:right-0">
              {suffix}
            </div>
          </div>
        ) : (
          field
        )}
        {error && <p id={errorId} className="text-xs text-accent-red-text">{error}</p>}
        {showHint && <p id={hintId} className="text-xs text-fg-secondary">{hint}</p>}
      </div>
    );
  },
);

Input.displayName = "Input";
