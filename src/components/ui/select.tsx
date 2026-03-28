import { forwardRef, type SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className = "", id, ...props }, ref) => {
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
        <select
          ref={ref}
          id={id}
          className={`h-8 w-full appearance-none rounded-sm border border-bg-tertiary bg-bg-primary px-3 pr-8 text-sm text-fg-primary transition-colors focus:border-accent-rose focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
            error ? "border-accent-red" : ""
          } ${className}`}
          {...props}
        >
          {placeholder && (
            <option value="" className="text-fg-muted">
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-accent-red">{error}</p>}
      </div>
    );
  },
);

Select.displayName = "Select";
