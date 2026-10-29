"use client";

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useId,
  type ChangeEvent,
} from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { isComposing } from "@/lib/shortcuts/shortcuts";
import { acquireSurface } from "@/lib/ui/surface-state";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  /** Shown, but not chosen (a role a person already has) */
  disabled?: boolean;
}

interface SelectProps {
  id?: string;
  "data-pager-control"?: string;
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
  /** Names the field when no visible label does (a fieldset's legend shows it) */
  ariaLabel?: string;
  /** The id of the text that explains the field */
  ariaDescribedby?: string;
  /**
   * A compact select inside a line of text or a chip (a credit's role): one
   * line tall, as wide as its value, which shows whole. It takes `ariaLabel`
   * and no label.
   */
  compact?: boolean;
  /**
   * The value wraps onto more lines and the field grows with it, for values
   * that identify something and must show whole, such as an edition (SLN-932)
   */
  wrap?: boolean;
}

export function Select({
  id: idProp,
  "data-pager-control": pagerControl,
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
  ariaLabel,
  ariaDescribedby,
  compact = false,
  wrap = false,
}: SelectProps) {
  // The label names the field through its id, so a field always has one
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const [isOpen, setIsOpen] = useState(false);
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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

  const closeList = useCallback(() => {
    setIsOpen(false);
    setActiveHint(null);
    setFocusIndex(-1);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  // The list owns Escape above its parent, including when a pointer leaves
  // focus on the dialog instead of the trigger. Outside clicks and Tab keep
  // their own focus destination; releasing a lease never moves focus.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const lease = acquireSurface(closeList);
    return () => lease.release();
  }, [isOpen, closeList]);

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
    if (allOptions.find((o) => o.value === optionValue)?.disabled) return;
    emitChange(optionValue);
    setIsOpen(false);
    setActiveHint(null);
    setFocusIndex(-1);
    containerRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled || isComposing(e.nativeEvent)) return;
    // ⌘Enter saves the form (shortcuts provider); keys with a modifier are not the list's
    if (e.metaKey || e.ctrlKey || e.altKey) return;

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
      case "Tab":
        setIsOpen(false);
        setActiveHint(null);
        setFocusIndex(-1);
        break;
    }
  }

  const hasAnyHints = allOptions.some((o) => o.hint);

  return (
    <div className={compact ? "inline-block shrink-0" : "space-y-1.5"} ref={containerRef}>
      {label && (
        <label
          id={`${id}-label`}
          htmlFor={id}
          className="type-label block"
        >
          {label}
          {required && <span className="ml-0.5 text-accent-red-text">*</span>}
        </label>
      )}

      <div className="relative">
        {/* Trigger button */}
        <button
          type="button"
          id={id}
          ref={triggerRef}
          role="combobox"
          // Labels can hydrate independently; only a changed value is a draft edit.
          data-draft-value={value ?? ""}
          data-pager-control={pagerControl}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedby}
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
          className={`flex justify-between rounded-sm border border-glass-border bg-bg-primary/80 text-left text-xs transition-colors duration-150 focus:border-accent-primary focus:outline-none focus:glass-input-focus disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:text-sm ${
            compact ? "h-5 items-center px-1.5 leading-5 pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:px-2"
              // A wrapped value keeps the chevron on its first line
              : wrap ? "min-h-8 w-full items-start px-3 py-[5px] leading-5 pointer-coarse:min-h-11 pointer-coarse:py-[11px]"
              : "h-8 w-full items-center px-3 pointer-coarse:h-11"
          } ${
            error ? "border-accent-red" : ""
          } ${isOpen ? "border-accent-primary" : ""} ${className}`}
        >
          {/* One line unless it wraps: a narrow trigger cuts the label with an
              ellipsis (the tooltip shows it whole) instead of wrapping out of its 32px */}
          <span
            className={`min-w-0 ${compact ? "whitespace-nowrap" : wrap ? "[overflow-wrap:anywhere]" : "truncate"} ${
              value === "" || value === undefined
                ? "text-fg-secondary"
                : "text-fg-primary"
            }`}
          >
            {displayLabel}
          </span>
          <ChevronDown
            className={`${compact ? "ml-1 h-3 w-3" : wrap ? "ml-2 mt-[3px] h-3.5 w-3.5" : "ml-2 h-3.5 w-3.5"} shrink-0 text-fg-secondary transition-transform duration-150 ${
              isOpen ? "rotate-180" : ""
            }`}
            strokeWidth={1.5}
          />
        </button>

        {/* Dropdown */}
        {isOpen && (
          // The glass never scrolls: its list does, inside it
          <div className={`glass absolute z-50 mt-1 overflow-hidden ${compact ? "min-w-full w-max" : "w-full"}`}>
            <div
              ref={listRef}
              role="listbox"
              // Named as its field is: by its own name, else by the label
              // that names the field (its own, or a setting row's, which
              // takes the same `${id}-label` id)
              aria-label={ariaLabel}
              aria-labelledby={ariaLabel ? undefined : `${id}-label`}
              className="max-h-56 overflow-y-auto"
            >
              {allOptions.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isFocused = idx === focusIndex;
                return (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled || undefined}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setFocusIndex(idx)}
                    className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-xs transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${
                      isSelected
                        ? "bg-accent-primary/10 text-fg-primary"
                        : isFocused
                          ? "bg-bg-tertiary text-fg-primary"
                          : "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                    }`}
                  >
                    <span>{opt.label}</span>
                    <div className="flex items-center gap-1.5">
                      {isSelected && (
                        <span className="text-micro text-accent-primary">
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
                          data-tooltip={`Help for ${opt.label}`}
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
          <div className="glass absolute z-[60] mt-1 w-full px-3 py-2">
            <p className="text-xs leading-relaxed text-fg-secondary">
              {allOptions.find((o) => o.value === activeHint)?.hint}
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-accent-red-text">{error}</p>}
    </div>
  );
}
