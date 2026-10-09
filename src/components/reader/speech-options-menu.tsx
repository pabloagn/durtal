"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";

const query = "(max-width: 639px)";
const subscribe = (changed: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
};

/** Uses the app's native popover/dialog patterns and returns focus on every close. */
export function SpeechOptionsMenu({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children: (close: () => void, sheet: boolean) => ReactNode;
}) {
  const sheet = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const change = useCallback((next: boolean) => setOpen(next), []);
  useEffect(() => {
    if (!open && wasOpen.current)
      queueMicrotask(() =>
        wrapper.current
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus({ preventScroll: true }),
      );
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open || !sheet) return;
    const dialog = wrapper.current?.querySelector("dialog");
    (
      dialog?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      dialog?.querySelector<HTMLButtonElement>("button[aria-pressed]")
    )?.focus();
  }, [open, sheet]);
  const trigger = (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      className="flex h-8 min-w-11 max-w-full items-center justify-center rounded-sm px-2 text-sm text-fg-secondary hover:bg-bg-tertiary/50 pointer-coarse:h-11 focus-visible:outline-offset-[-2px]"
    >
      <span className="lines-1 min-w-0">{value}</span>
    </button>
  );
  return (
    <div ref={wrapper} className="min-w-0">
      {sheet ? (
        <>
          <button
            type="button"
            aria-label={label}
            data-tooltip={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              change(true);
            }}
            className={trigger.props.className}
          >
            <span className="lines-1 min-w-0">{value}</span>
          </button>
          <Dialog
            open={open}
            onClose={() => change(false)}
            title={label}
            expandable={false}
            className="fixed inset-x-0 bottom-0 top-auto m-0! max-w-none! max-h-[80dvh] rounded-t-md motion-reduce:transition-none motion-reduce:animate-none!"
          >
            {children(() => change(false), true)}
          </Dialog>
        </>
      ) : (
        <DropdownMenu
          label={label}
          trigger={trigger}
          side="top"
          open={open}
          onOpenChange={change}
        >
          {children(() => change(false), false)}
        </DropdownMenu>
      )}
    </div>
  );
}
