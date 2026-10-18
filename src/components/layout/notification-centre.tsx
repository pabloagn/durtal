"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Bell, CircleAlert, TriangleAlert, X } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  clearAll,
  getEntries,
  getServerEntries,
  markRead,
  remove,
  subscribe,
  type NotificationEntry,
} from "@/lib/notifications/history";

const TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(at: number, now: number) {
  const minutes = Math.round((at - now) / 60000);
  if (minutes > -1) return "just now";
  if (minutes > -60) return TIME.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return TIME.format(hours, "hour");
  return TIME.format(Math.round(hours / 24), "day");
}

// One line each, beside the heading, at every width (SLN-922)
const ACTION =
  "whitespace-nowrap rounded-sm px-2 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary pointer-coarse:min-h-11";

function Entry({ entry, now, onRemove }: { entry: NotificationEntry; now: number; onRemove: (button: HTMLButtonElement) => void }) {
  const Icon = entry.kind === "error" ? CircleAlert : TriangleAlert;
  return (
    <li className="flex gap-2.5 py-2.5 pl-3 pr-1 text-xs" data-notification={entry.read ? "read" : "unread"}>
      <CapAligned height={16}>
        <Icon
          className={`h-4 w-4 ${entry.kind === "error" ? "text-accent-red-text" : "text-accent-gold"}`}
          strokeWidth={1.5}
          aria-label={entry.kind === "error" ? "Error" : "Warning"}
        />
      </CapAligned>
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className={entry.read ? "text-fg-secondary" : "font-medium text-fg-primary"}>
          {entry.title}
          {!entry.read && <span className="sr-only"> (unread)</span>}
        </p>
        {entry.description && <p className="mt-0.5 text-fg-secondary">{entry.description}</p>}
        <p className="mt-1 text-fg-secondary">
          {ago(entry.at, now)}
          {entry.count > 1 && ` · ${entry.count} times`}
        </p>
      </div>
      <CapAligned height={24} coarseHeight={44}>
        <button
          type="button"
          onClick={(event) => {
            onRemove(event.currentTarget);
            remove(entry.id);
          }}
          aria-label={`Remove "${entry.title}"`}
          data-notification-remove=""
          data-tooltip="Remove"
          className="flex h-full w-6 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary pointer-coarse:w-11"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </CapAligned>
    </li>
  );
}

/**
 * The bell that opens the notification history (SLN-567): the errors and
 * warnings this browser showed, newest first. The ones seen while it is open
 * count as read when it closes. Each can be removed, or all at once.
 */
export function NotificationCentre({
  className,
  tooltipSide = "top",
}: {
  /** The button's own classes: the bar's or the sidebar's */
  className: string;
  tooltipSide?: "top" | "bottom" | "right";
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const entries = useSyncExternalStore(subscribe, getEntries, getServerEntries);
  const seen = useRef<string[]>([]);
  const unread = entries.filter((e) => !e.read).length;
  // The times are as of opening
  const [now, setNow] = useState(0);
  // Its expanded state also keeps the bell's tooltip off the open panel
  const [open, setOpen] = useState(false);

  // Placed beside the button, inside a 16px gutter; read on close
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const toggle = (e: Event) => {
      setOpen((e as ToggleEvent).newState === "open");
      if ((e as ToggleEvent).newState !== "open") {
        markRead(seen.current);
        seen.current = [];
        return;
      }
      seen.current = getEntries().map((entry) => entry.id);
      setNow(Date.now());
      const b = button.current!.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 32);
      el.style.width = `${width}px`;
      el.style.left = `${Math.max(16, Math.min(b.left, window.innerWidth - 16 - width))}px`;
      const below = b.bottom + 4;
      el.style.top = `${below + el.offsetHeight > window.innerHeight - 16 ? Math.max(16, b.top - 4 - el.offsetHeight) : below}px`;
    };
    el.addEventListener("toggle", toggle);
    return () => el.removeEventListener("toggle", toggle);
  }, []);

  // Entries that arrive while it is open are seen too
  useEffect(() => {
    if (pop.current?.matches(":popover-open"))
      seen.current = entries.map((entry) => entry.id);
  }, [entries]);

  // Each of these removes the button it is pressed on: the focus moves first,
  // so it never falls to the page body (SLN-922). Remove hands it to the
  // next entry's Remove, else the one before, else the panel; Mark all read
  // to Clear all; Clear all to the panel, which Esc still closes
  const clear = useRef<HTMLButtonElement>(null);
  function handOn(removing: HTMLButtonElement) {
    const all = [...(pop.current?.querySelectorAll<HTMLButtonElement>("[data-notification-remove]") ?? [])];
    const at = all.indexOf(removing);
    (all[at + 1] ?? all[at - 1] ?? pop.current)?.focus();
  }

  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={label}
        aria-expanded={open}
        data-tooltip="Notifications"
        data-tooltip-side={tooltipSide}
        data-notification-centre=""
        className={`relative ${className}`}
      >
        <Bell className="h-4 w-4" strokeWidth={1.5} />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 ml-1 -mt-2.5 h-1.5 w-1.5 rounded-full bg-accent-red-text"
          />
        )}
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Notifications"
        // Takes the focus when the button that had it goes (Clear all)
        tabIndex={-1}
        className="glass fixed outline-none inset-auto m-0 max-h-[min(480px,70vh)] flex-col open:flex overflow-hidden border-0 bg-transparent p-0 text-fg-primary"
        data-notification-popover=""
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-glass-border py-1.5 pl-3 pr-1">
          {/* A functional heading, Inter at the dialogs' size, so the two
              actions beside it keep one line each (SLN-922) */}
          <h2 className="type-dialog-title mr-auto">Notifications</h2>
          {unread > 0 && (
            <button
              type="button"
              className={ACTION}
              onClick={() => {
                clear.current?.focus();
                markRead(entries.map((e) => e.id));
              }}
            >
              Mark all read
            </button>
          )}
          {entries.length > 0 && (
            <button
              ref={clear}
              type="button"
              className={ACTION}
              onClick={() => {
                pop.current?.focus();
                clearAll();
              }}
            >
              Clear all
            </button>
          )}
        </div>
        {entries.length ? (
          // Positioned, so each entry's hidden "(unread)" stays inside the
          // list that scrolls; else it is placed in the panel, which grows a
          // scroll height of the whole list behind its overflow-hidden
          <ul className="relative min-h-0 flex-1 divide-y divide-glass-border overflow-y-auto overscroll-contain">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} now={now} onRemove={handOn} />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-4 text-xs text-fg-secondary">
            No notifications. Errors and warnings stay here for two weeks.
          </p>
        )}
      </div>
    </>
  );
}
