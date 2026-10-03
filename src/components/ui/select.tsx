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
  "aria-label"?: string;
  /** Show a search box above the options: for long lists */
  searchable?: boolean;
  searchPlaceholder?: string;
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
  "aria-label": ariaLabel,
  searchable = false,
  searchPlaceholder = "Search…",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  // Build full options list including placeholder
  const allOptions: SelectOption[] = placeholder
    ? [{ value: "", label: placeholder }, ...options]
    : options;

  const selectedOption = allOptions.find((o) => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? "";

  // A search narrows the list to the options whose label holds the text
  const search = query.trim().toLowerCase();
  const visibleOptions = search
    ? allOptions.filter(
        (o) => o.value !== "" && o.label.toLowerCase().includes(search),
      )
    : allOptions;

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
        setQuery("");
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

  function close() {
    setIsOpen(false);
    setActiveHint(null);
    setFocusIndex(-1);
    setQuery("");
  }

  function handleSelect(optionValue: string) {
    emitChange(optionValue);
    close();
    if (searchable) triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    // In the search box a space is text, not a command
    const inSearch = e.target instanceof HTMLInputElement;

    switch (e.key) {
      case "Enter":
      case " ":
        if (inSearch && e.key === " ") break;
        e.preventDefault();
        if (isOpen && focusIndex >= 0 && visibleOptions[focusIndex]) {
          handleSelect(visibleOptions[focusIndex].value);
        } else if (!isOpen) {
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
            prev < visibleOptions.length - 1 ? prev + 1 : prev,
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
        close();
        if (inSearch) triggerRef.current?.focus();
        break;
      case "Tab":
        close();
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
          ref={triggerRef}
          type="button"
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            if (isOpen) return close();
            setIsOpen(true);
            const idx = allOptions.findIndex((o) => o.value === value);
            setFocusIndex(idx >= 0 ? idx : 0);
          }}
          onKeyDown={handleKeyDown}
          className={`flex h-8 w-full items-center justify-between gap-2 rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-left text-sm transition-all duration-150 focus:border-accent-rose focus:outline-none focus:glass-input-focus disabled:cursor-not-allowed disabled:opacity-40 ${
            error ? "border-accent-red" : ""
          } ${isOpen ? "border-accent-rose" : ""} ${className}`}
        >
          <span
            className={`min-w-0 truncate ${
              value === "" || value === undefined
                ? "text-fg-muted"
                : "text-fg-primary"
            }`}
          >
            {displayLabel}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform duration-150 ${
              isOpen ? "rotate-180" : ""
            }`}
            strokeWidth={1.5}
          />
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute z-50 mt-1 w-full rounded-sm border border-glass-border bg-bg-secondary shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]">
            {searchable && (
              <div className="border-b border-glass-border p-1.5">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setFocusIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder.replace(/…$/, "")}
                  className="h-7 w-full rounded-sm border border-glass-border bg-bg-primary px-2 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
                />
              </div>
            )}
            <div
              ref={listRef}
              role="listbox"
              className="max-h-56 overflow-y-auto"
            >
              {visibleOptions.length === 0 && (
                <p className="px-3 py-1.5 text-sm text-fg-muted">No matches</p>
              )}
              {visibleOptions.map((opt, idx) => {
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
