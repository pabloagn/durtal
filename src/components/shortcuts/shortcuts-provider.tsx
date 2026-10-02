"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthorCreateDialog } from "@/app/authors/author-create-dialog";
import { Kbd } from "@/components/shortcuts/kbd";
import { ShortcutsHelp } from "@/components/shortcuts/shortcuts-help";
import {
  GO_TO,
  isConfirmField,
  isMacPlatform,
  isTyping,
  pageSearchField,
  shortcutButton,
} from "@/lib/shortcuts/shortcuts";

interface PageShortcut {
  key: string;
  label: string;
  run: () => void;
}

interface ShortcutsContextValue {
  register: (shortcut: PageShortcut) => () => void;
  openHelp: () => void;
  openNewAuthor: () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

/** Actions that the command palette shares with the keys */
export function useShortcutActions() {
  const value = useContext(ShortcutsContext);
  if (!value) throw new Error("useShortcutActions needs ShortcutsProvider");
  return value;
}

/**
 * A single-key shortcut for the page that is open ("E" edits the book). It
 * shows in the shortcuts sheet under "This page" while the page is open.
 */
export function useShortcut(key: string, label: string, run: () => void) {
  const context = useContext(ShortcutsContext);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    if (!context) return;
    return context.register({ key, label, run: () => runRef.current() });
  }, [context, key, label]);
}

/** Time to press the second key of "G then L" */
const SEQUENCE_MS = 1500;

/** Reader view (/reader/{id}) keeps single keys for its own controls */
const READER_VIEW_RE = /^\/reader\/\d+/;

export function ShortcutsProvider({
  paletteOpen,
  onPaletteOpenChange,
  children,
}: {
  paletteOpen: boolean;
  onPaletteOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [goPending, setGoPending] = useState(false);
  const [pageShortcuts, setPageShortcuts] = useState<PageShortcut[]>([]);

  const register = useCallback((shortcut: PageShortcut) => {
    setPageShortcuts((list) => [...list, shortcut]);
    return () => setPageShortcuts((list) => list.filter((s) => s !== shortcut));
  }, []);

  const context = useMemo(
    () => ({
      register,
      openHelp: () => setHelpOpen(true),
      openNewAuthor: () => setAuthorOpen(true),
    }),
    [register],
  );

  // "G" waits a moment for the second key
  useEffect(() => {
    if (!goPending) return;
    const timer = setTimeout(() => setGoPending(false), SEQUENCE_MS);
    return () => clearTimeout(timer);
  }, [goPending]);

  useEffect(() => {
    const mac = isMacPlatform();

    function press(event: KeyboardEvent, button: HTMLButtonElement | null) {
      if (!button) return;
      event.preventDefault();
      button.click();
    }

    function onKeyDown(event: KeyboardEvent) {
      // A handler on the page took the key, or an input method is composing
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
        return;
      const target = event.target as HTMLElement | null;
      const mod = mac ? event.metaKey : event.ctrlKey;
      const otherMod = mac ? event.ctrlKey : event.metaKey;
      const key = event.key.toLowerCase();

      // ⌘K: the command palette, everywhere
      if (mod && !otherMod && !event.altKey && !event.shiftKey && key === "k") {
        event.preventDefault();
        onPaletteOpenChange(!paletteOpen);
        return;
      }
      if (paletteOpen) {
        if (event.key === "Escape") onPaletteOpenChange(false);
        return;
      }

      // ⌥F: the fix button of the field ("Capitalize title", name order).
      // event.code, as ⌥F types "ƒ" on a Mac.
      if (event.altKey && !mod && !otherMod && event.code === "KeyF") {
        const button = target
          ?.closest("[data-field]")
          ?.querySelector<HTMLButtonElement>("[data-field-action]");
        if (button) {
          event.preventDefault();
          if (button.dataset.active !== undefined && !button.disabled) button.click();
        }
        return;
      }

      // ⌘Enter saves; Enter in a one-line field confirms
      if (event.key === "Enter" && !event.altKey && !event.shiftKey && !otherMod) {
        if (mod) press(event, shortcutButton(target, "save"));
        else if (isConfirmField(target)) press(event, shortcutButton(target, "next"));
        return;
      }

      // Single keys: never while typing, in a dialog, or in the reader
      if (
        mod ||
        otherMod ||
        event.altKey ||
        isTyping(target) ||
        document.querySelector("dialog[open]") ||
        READER_VIEW_RE.test(pathname)
      ) {
        if (goPending) setGoPending(false);
        return;
      }

      if (goPending) {
        setGoPending(false);
        const place = GO_TO.find((g) => g.key === key);
        if (place && !event.shiftKey) {
          event.preventDefault();
          router.push(place.href);
        }
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        const field = pageSearchField();
        if (field) {
          field.focus();
          field.select();
        } else onPaletteOpenChange(true);
        return;
      }
      if (event.shiftKey || event.key.length !== 1) return;

      const pageShortcut = pageShortcuts.findLast((s) => s.key === key);
      if (pageShortcut) {
        event.preventDefault();
        pageShortcut.run();
        return;
      }
      switch (key) {
        case "g":
          event.preventDefault();
          setGoPending(true);
          return;
        case "n":
          event.preventDefault();
          if (pathname === "/library/new") pageSearchField()?.focus();
          else router.push("/library/new");
          return;
        case "a":
          event.preventDefault();
          setAuthorOpen(true);
          return;
      }
    }

    // Window, bubble phase: page handlers run first and can take a key
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, pathname, paletteOpen, onPaletteOpenChange, goPending, pageShortcuts]);

  return (
    <ShortcutsContext.Provider value={context}>
      {children}
      <ShortcutsHelp
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        pageShortcuts={pageShortcuts}
      />
      <AuthorCreateDialog open={authorOpen} onOpenChange={setAuthorOpen} />
      {goPending && <GoToHint />}
    </ShortcutsContext.Provider>
  );
}

/** After "G": where the second key goes */
function GoToHint() {
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-sm border border-glass-border bg-bg-secondary px-4 py-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
    >
      <p className="mb-2 text-xs font-medium text-fg-muted">Go to</p>
      <ul className="grid grid-cols-4 gap-x-5 gap-y-1.5">
        {GO_TO.map((g) => (
          <li key={g.key} className="flex items-center gap-2 text-sm text-fg-secondary">
            <Kbd>{g.key.toUpperCase()}</Kbd>
            {g.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
