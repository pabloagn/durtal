"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ChangeEvent,
} from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SelectProps {
  id?: string;
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  name?: string;
}

export function Select({
  id,
  label,
  error,
  options,
  placeholder,
  value,
  onChange,
  disabled,
  className = "",
  required,
  name,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  // Build full options list including placeholder
  const allOptions: SelectOption[] = placeholder
    ? [{ value: "", label: placeholder }, ...options]
    : options;

  const selectedOption = allOptions.find((o) => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? "";

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setActiveHint(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || focusIndex < 0 || !listRef.current) return;
    const items = listRef.current.children;
    if (items[focusIndex]) {
      (items[focusIndex] as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex, isOpen]);

  const emitChange = useCallback(
    (newValue: string) => {
      if (!onChange) return;
      // Create a synthetic event compatible with e.target.value pattern
      const syntheticEvent = {
        target: { value: newValue, name: name ?? "" },
      } as ChangeEvent<HTMLSelectElement>;
      onChange(syntheticEvent);
    },
    [onChange, name],
  );

  function handleSelect(optionValue: string) {
    emitChange(optionValue);
    setIsOpen(false);
    setActiveHint(null);
    setFocusIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (isOpen && focusIndex >= 0) {
          handleSelect(allOptions[focusIndex].value);
        } else {
          setIsOpen(true);
          // Focus current value
          const idx = allOptions.findIndex((o) => o.value === value);
          setFocusIndex(idx >= 0 ? idx : 0);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          const idx = allOptions.findIndex((o) => o.value === value);
          setFocusIndex(idx >= 0 ? idx : 0);
        } else {
          setFocusIndex((prev) =>
            prev < allOptions.length - 1 ? prev + 1 : prev,
          );
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (isOpen) {
          setFocusIndex((prev) => (prev > 0 ? prev - 1 : prev));
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setActiveHint(null);
        setFocusIndex(-1);
        break;
      case "Tab":
        setIsOpen(false);
        setActiveHint(null);
        setFocusIndex(-1);
        break;
    }
  }

  const hasAnyHints = allOptions.some((o) => o.hint);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-medium text-fg-secondary"
        >
          {label}
          {required && <span className="ml-0.5 text-accent-red">*</span>}
        </label>
      )}

      <div className="relative">
        {/* Trigger button */}
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setIsOpen((prev) => !prev);
              if (!isOpen) {
                const idx = allOptions.findIndex((o) => o.value === value);
                setFocusIndex(idx >= 0 ? idx : 0);
              }
            }
          }}
          onKeyDown={handleKeyDown}
          className={`flex h-8 w-full items-center justify-between rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-left text-sm transition-all duration-150 focus:border-accent-rose focus:outline-none focus:glass-input-focus disabled:cursor-not-allowed disabled:opacity-40 ${
            error ? "border-accent-red" : ""
          } ${isOpen ? "border-accent-rose" : ""} ${className}`}
        >
          <span
            className={
              value === "" || value === undefined
                ? "text-fg-muted"
                : "text-fg-primary"
            }
          >
            {displayLabel}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-fg-muted transition-transform duration-150 ${
              isOpen ? "rotate-180" : ""
            }`}
            strokeWidth={1.5}
          />
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div
            ref={listRef}
            role="listbox"
            className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-sm border border-glass-border bg-bg-secondary shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]"
          >
            {allOptions.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isFocused = idx === focusIndex;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value)}
                  onMouseEnter={() => setFocusIndex(idx)}
                  className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm transition-colors ${
                    isSelected
                      ? "bg-accent-rose/10 text-fg-primary"
                      : isFocused
                        ? "bg-bg-tertiary text-fg-primary"
                        : "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                  }`}
                >
                  <span>{opt.label}</span>
                  <div className="flex items-center gap-1.5">
                    {isSelected && (
                      <span className="text-micro text-accent-rose">
                        &#10003;
                      </span>
                    )}
                    {opt.hint && hasAnyHints && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveHint(
                            activeHint === opt.value ? null : opt.value,
                          );
                        }}
                        className="rounded-sm p-0.5 text-fg-muted transition-colors hover:text-fg-secondary"
                        aria-label={`Help for ${opt.label}`}
                      >
                        <HelpCircle className="h-3 w-3" strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Hint tooltip */}
        {activeHint && (
          <div className="absolute z-[60] mt-1 w-full rounded-sm border border-glass-border bg-bg-primary px-3 py-2 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]">
            <p className="text-xs leading-relaxed text-fg-secondary">
              {allOptions.find((o) => o.value === activeHint)?.hint}
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-accent-red">{error}</p>}
    </div>
  );
}
