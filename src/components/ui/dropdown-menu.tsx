"use client";

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
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
import { CapAligned } from "@/components/shared/cap-aligned";
import { placeMenu } from "@/lib/utils/menu-placement";

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

  // The native top layer escapes card/toolbar clipping while keeping the
  // menu beside its trigger in the DOM (dialog focus restoration uses this).
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current || !triggerRef.current) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    menu.showPopover?.();
    function position() {
      const viewport = window.visualViewport;
      const bounds = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
      };
      menu.style.setProperty(
        "--menu-width",
        `${Math.max(0, bounds.width - 16)}px`,
      );
      const list = menu.firstElementChild as HTMLElement;
      const placement = placeMenu(
        trigger.getBoundingClientRect(),
        {
          width: menu.getBoundingClientRect().width,
          height: list.scrollHeight,
        },
        bounds,
        align,
        side,
      );
      menu.style.left = `${placement.left}px`;
      menu.style.top = `${placement.top}px`;
      menu.style.setProperty("--menu-height", `${placement.height}px`);
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(menu);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      position();
    };
    window.addEventListener("resize", position);
    document.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      menu.hidePopover?.();
    };
  }, [isOpen, align, side]);

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
        menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        ),
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
            aria-label={label}
            popover="manual"
            className="glass dropdown-panel fixed z-50 overflow-hidden"
          >
            <div className="dropdown-list overflow-y-auto overscroll-contain py-1">
              {children}
            </div>
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
  shortcut?: string;
}

export function DropdownMenuItem({
  children,
  onClick,
  disabled = false,
  variant = "default",
  icon,
  shortcut,
}: DropdownMenuItemProps) {
  const { close } = useContext(DropdownMenuContext);

  const baseClass =
    "dropdown-item py-2 text-sm text-left transition-colors outline-none pointer-coarse:min-h-11";
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
      <span className="dropdown-icon" data-menu-icon={icon ? "" : undefined}>
        {icon && (
          <CapAligned height={16}>
            <span className="flex size-4 items-center justify-center">
              {icon}
            </span>
          </CapAligned>
        )}
      </span>
      <span className="dropdown-label">{children}</span>
      <span
        className="dropdown-shortcut font-mono text-micro text-fg-secondary"
        data-menu-shortcut={shortcut ? "" : undefined}
      >
        {shortcut}
      </span>
    </div>
  );
}

/* ── DropdownMenuSeparator ──────────────────────────────────────────────── */

export function DropdownMenuSeparator() {
  return (
    <div role="separator" className="-mx-3 my-1 border-t border-glass-border" />
  );
}

/* ── DropdownMenuLabel ──────────────────────────────────────────────────── */

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <div className="type-caption py-1.5 break-words">{children}</div>;
}
