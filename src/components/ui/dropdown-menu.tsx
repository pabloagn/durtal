"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  createContext,
  useContext,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { isComposing } from "@/lib/shortcuts/shortcuts";

/* ── Context ────────────────────────────────────────────────────────────── */

interface DropdownMenuContextValue {
  close: () => void;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue>({
  close: () => {},
});

/* ── DropdownMenu (root) ────────────────────────────────────────────────── */

interface TriggerProps {
  ref?: Ref<HTMLButtonElement>;
  type?: "button";
  "aria-label"?: string;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
  "data-tooltip"?: string;
  onClick?: (e: MouseEvent) => void;
}

interface DropdownMenuProps {
  /** One `<button>` element. The menu adds its handlers and ARIA state to it. */
  trigger: ReactElement<TriggerProps>;
  /** Names an icon-only trigger, and shows as its tooltip */
  label?: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DropdownMenu({
  trigger,
  label,
  children,
  align = "end",
  side = "bottom",
  open: controlledOpen,
  onOpenChange,
}: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: globalThis.MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, setOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape" && !isComposing(e)) {
        // The menu closes; the dialog around it stays (one layer per Esc)
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, setOpen]);

  // Arrow-key navigation inside menu
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const menu = menuRef.current;

    function getItems(): HTMLElement[] {
      return Array.from(
        menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'),
      );
    }

    function handleKey(e: globalThis.KeyboardEvent) {
      const items = getItems();
      if (items.length === 0) return;

      const active = document.activeElement as HTMLElement;
      const idx = items.indexOf(active);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = idx < items.length - 1 ? idx + 1 : 0;
        items[next].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = idx > 0 ? idx - 1 : items.length - 1;
        items[prev].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1].focus();
      }
    }

    menu.addEventListener("keydown", handleKey);
    return () => menu.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  // Focus first item when menu opens
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      );
      first?.focus();
    });
  }, [isOpen]);

  const alignClass =
    align === "start"
      ? "left-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "right-0";

  const sideClass = side === "top" ? "bottom-full mb-1" : "top-full mt-1";

  return (
    <DropdownMenuContext.Provider value={{ close }}>
      <div ref={containerRef} className="relative inline-flex">
        {/* Trigger */}
        {cloneElement(trigger, {
          ref: triggerRef,
          type: "button",
          "aria-haspopup": "menu",
          "aria-expanded": isOpen,
          ...(label && { "aria-label": label, "data-tooltip": label }),
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen(!isOpen);
          },
        })}

        {/* Menu panel */}
        {isOpen && (
          <div
            ref={menuRef}
            role="menu"
            className={`glass absolute z-50 min-w-[180px] overflow-hidden py-1 ${alignClass} ${sideClass}`}
          >
            {children}
          </div>
        )}
      </div>
    </DropdownMenuContext.Provider>
  );
}

/* ── DropdownMenuItem ───────────────────────────────────────────────────── */

interface DropdownMenuItemProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
  icon?: ReactNode;
}

export function DropdownMenuItem({
  children,
  onClick,
  disabled = false,
  variant = "default",
  icon,
}: DropdownMenuItemProps) {
  const { close } = useContext(DropdownMenuContext);

  const baseClass =
    "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors outline-none pointer-coarse:min-h-11";
  const variantClass =
    variant === "danger"
      ? "text-accent-red-text hover:bg-accent-red/10 focus:bg-accent-red/10"
      : "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary focus:bg-bg-tertiary focus:text-fg-primary";
  const disabledClass = disabled
    ? "opacity-40 cursor-not-allowed"
    : "cursor-pointer";

  return (
    <div
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClick?.();
        close();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
          close();
        }
      }}
      className={`${baseClass} ${variantClass} ${disabledClass}`}
    >
      {icon && (
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      {children}
    </div>
  );
}

/* ── DropdownMenuSeparator ──────────────────────────────────────────────── */

export function DropdownMenuSeparator() {
  return <div role="separator" className="my-1 border-t border-glass-border" />;
}

/* ── DropdownMenuLabel ──────────────────────────────────────────────────── */

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="type-caption px-3 py-1.5">
      {children}
    </div>
  );
}
