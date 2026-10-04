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
import { Copy, Link2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { AuthorCreateDialog } from "@/app/people/author-create-dialog";
import { VenueCreateDialog } from "@/app/places/venue-create-dialog";
import { CreateCollectionDialog } from "@/components/collections/create-collection-dialog";
import { RecommenderFormDialog } from "@/components/recommenders/recommender-form-dialog";
import { SeriesFormDialog } from "@/components/series/series-form-dialog";
import { LeaderMenu, type LeaderMenuItem } from "@/components/shortcuts/leader-menu";
import { SECTION_ICONS } from "@/components/shortcuts/section-icons";
import { ShortcutsHelp } from "@/components/shortcuts/shortcuts-help";
import {
  ADD,
  COPY_KEYS,
  GO_TO,
  isConfirmField,
  isMacPlatform,
  isTyping,
  pageSearchField,
  pickerOptions,
  shortcutButton,
  type AddDialog,
} from "@/lib/shortcuts/shortcuts";

interface PageShortcut {
  key: string;
  label: string;
  run: () => void;
}

/** An edit action the open page offers (E menu): "Work", opens the edit dialog */
export interface EditItem {
  key: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

/** Something the open page offers to copy (Y menu): "ISBN", "9780099518471" */
export interface CopyItem {
  key: string;
  label: string;
  text: string;
}

interface ShortcutsContextValue {
  register: (shortcut: PageShortcut) => () => void;
  registerCopy: (items: CopyItem[]) => () => void;
  registerEdit: (items: EditItem[]) => () => void;
  registerReading: (items: EditItem[]) => () => void;
  openHelp: () => void;
  /** Runs an "Add" entry by its key ("b" adds a book) */
  add: (key: string) => void;
  /** What Y copies on this page, the link last */
  copyItems: () => CopyItem[];
  copy: (item: CopyItem) => void;
  /** What E edits on this page; empty where the page has no edit actions */
  editItems: () => EditItem[];
  /** What R does on this page (a book: Start, Log progress, Finish); empty elsewhere */
  readingItems: () => EditItem[];
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

/** Actions that the command palette shares with the keys */
export function useShortcutActions() {
  const value = useContext(ShortcutsContext);
  if (!value) throw new Error("useShortcutActions needs ShortcutsProvider");
  return value;
}

/**
 * A single-key shortcut for the page that is open. It
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

/**
 * What the page offers to copy, for the Y menu and the palette. Entries with
 * no text (a book without an ISBN) are left out.
 */
export function useCopyItems(items: { key: string; label: string; text?: string | null }[]) {
  const context = useContext(ShortcutsContext);
  const signature = JSON.stringify(items.filter((i) => i.text?.trim()));
  useEffect(() => {
    if (!context) return;
    return context.registerCopy(JSON.parse(signature) as CopyItem[]);
  }, [context, signature]);
}

/**
 * The edit actions of the open page, for the E menu and the palette. The
 * menu runs the latest `run` of each entry.
 */
export function useEditActions(items: EditItem[]) {
  const context = useContext(ShortcutsContext);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  const signature = items.map((i) => `${i.key}:${i.label}`).join("|");
  useEffect(() => {
    if (!context) return;
    return context.registerEdit(
      itemsRef.current.map((item, i) => ({
        ...item,
        run: () => itemsRef.current[i]?.run(),
      })),
    );
  }, [context, signature]);
}

/**
 * The reading actions of a book page, for the R menu and the palette (SLN-447):
 * the same contract as `useEditActions`.
 */
export function useReadingActions(items: EditItem[]) {
  const context = useContext(ShortcutsContext);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  const signature = items.map((i) => `${i.key}:${i.label}`).join("|");
  useEffect(() => {
    if (!context) return;
    return context.registerReading(
      itemsRef.current.map((item, i) => ({
        ...item,
        run: () => itemsRef.current[i]?.run(),
      })),
    );
  }, [context, signature]);
}

/** Reader view (/reader/{id}) keeps single keys for its own controls */
const READER_VIEW_RE = /^\/reader\/\d+/;

type MenuName = "add" | "go" | "copy" | "edit" | "reading";

const STATIC_MENUS = {
  add: ADD.map((a) => ({ key: a.key, label: a.label, icon: SECTION_ICONS[a.section] })),
  go: GO_TO.map((g) => ({ key: g.key, label: g.label, icon: SECTION_ICONS[g.href] })),
};
const MENU_TITLES: Record<MenuName, string> = {
  add: "Add",
  go: "Go to",
  copy: "Copy",
  edit: "Edit",
  reading: "Reading",
};

/**
 * Puts text on the clipboard. Where the browser refuses the clipboard API
 * (permission denied), the older copy command still works from a key press.
 */
async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const focused = document.activeElement as HTMLElement | null;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    focused?.focus();
    if (!copied) throw new Error("Copy refused");
  }
}

/** One line of copied text for the menu: long text is cut by the menu */
function preview(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** The list choice that ↑ ↓ moved to; Enter picks it (else the first) */
let activeChoice: HTMLElement | null = null;
function setActiveChoice(choice: HTMLElement | null) {
  activeChoice?.removeAttribute("data-kb-active");
  activeChoice = choice;
  if (!choice) return;
  choice.setAttribute("data-kb-active", "");
  choice.scrollIntoView({ block: "nearest" });
}

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
  const [addDialog, setAddDialog] = useState<AddDialog | null>(null);
  const [menu, setMenu] = useState<MenuName | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [pageShortcuts, setPageShortcuts] = useState<PageShortcut[]>([]);
  // A ref, not state: menus and the palette read it when they open, and the
  // context stays the same object (a new one would make pages register again)
  const pageCopyItems = useRef<CopyItem[]>([]);
  const pageEditItems = useRef<EditItem[]>([]);
  const pageReadingItems = useRef<EditItem[]>([]);

  const register = useCallback((shortcut: PageShortcut) => {
    setPageShortcuts((list) => [...list, shortcut]);
    return () => setPageShortcuts((list) => list.filter((s) => s !== shortcut));
  }, []);

  const registerCopy = useCallback((items: CopyItem[]) => {
    pageCopyItems.current = items;
    return () => {
      if (pageCopyItems.current === items) pageCopyItems.current = [];
    };
  }, []);

  const registerEdit = useCallback((items: EditItem[]) => {
    pageEditItems.current = items;
    return () => {
      if (pageEditItems.current === items) pageEditItems.current = [];
    };
  }, []);

  const editItems = useCallback(() => pageEditItems.current, []);

  const registerReading = useCallback((items: EditItem[]) => {
    pageReadingItems.current = items;
    return () => {
      if (pageReadingItems.current === items) pageReadingItems.current = [];
    };
  }, []);

  const readingItems = useCallback(() => pageReadingItems.current, []);

  const copyItems = useCallback(
    (): CopyItem[] => [
      ...pageCopyItems.current,
      // The command palette renders on the server too, which has no window
      {
        key: COPY_KEYS.link,
        label: "Link",
        text: typeof window === "undefined" ? "" : window.location.href,
      },
    ],
    [],
  );

  const copy = useCallback(async (item: CopyItem) => {
    try {
      await writeClipboard(item.text);
      toast.success(`${item.label} copied`, { description: preview(item.text) });
    } catch {
      toast.error("Could not copy. Allow clipboard access and try again.");
    }
  }, []);

  const add = useCallback(
    (key: string) => {
      const entry = ADD.find((a) => a.key === key);
      if (!entry) return;
      if ("href" in entry) router.push(entry.href);
      else setAddDialog(entry.dialog);
    },
    [router],
  );

  const context = useMemo(
    () => ({
      register,
      registerCopy,
      registerEdit,
      registerReading,
      openHelp: () => setHelpOpen(true),
      add,
      copyItems,
      copy,
      editItems,
      readingItems,
    }),
    [register, registerCopy, registerEdit, registerReading, add, copyItems, copy, editItems, readingItems],
  );

  const openMenu = (name: MenuName) => {
    setMenuIndex(0);
    setMenu(name);
  };

  const menuItems = useMemo((): LeaderMenuItem[] => {
    if (menu === "add" || menu === "go") return STATIC_MENUS[menu];
    if (menu === "copy")
      return copyItems().map((item) => ({
        key: item.key,
        label: item.label,
        icon: item.key === COPY_KEYS.link ? Link2 : Copy,
        hint: preview(item.text),
      }));
    if (menu === "edit")
      return editItems().map(({ key, label, icon }) => ({ key, label, icon }));
    if (menu === "reading")
      return readingItems().map(({ key, label, icon }) => ({ key, label, icon }));
    return [];
  }, [menu, copyItems, editItems, readingItems]);

  const pickMenuItem = useCallback(
    (name: MenuName, index: number) => {
      setMenu(null);
      if (name === "add") add(ADD[index].key);
      else if (name === "go") router.push(GO_TO[index].href);
      else if (name === "edit") editItems()[index]?.run();
      else if (name === "reading") readingItems()[index]?.run();
      else void copy(copyItems()[index]);
    },
    [add, router, copy, copyItems, editItems, readingItems],
  );

  // An open menu takes every key first (capture phase)
  useEffect(() => {
    if (!menu) return;
    const open = menu;
    const items = menuItems;
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowDown")
        setMenuIndex((i) => (i + 1) % items.length);
      else if (event.key === "ArrowUp")
        setMenuIndex((i) => (i - 1 + items.length) % items.length);
      else if (event.key === "Enter") pickMenuItem(open, menuIndex);
      else if (event.key === "Escape") setMenu(null);
      else {
        const index = items.findIndex((item) => item.key === event.key.toLowerCase());
        if (index >= 0) pickMenuItem(open, index);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [menu, menuIndex, menuItems, pickMenuItem]);

  // Typing changes a list: the ↑ ↓ choice starts over
  useEffect(() => {
    const reset = () => setActiveChoice(null);
    window.addEventListener("input", reset, true);
    return () => window.removeEventListener("input", reset, true);
  }, []);

  useEffect(() => {
    const mac = isMacPlatform();

    function press(event: KeyboardEvent, button: HTMLElement | null) {
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
      const plain = !mod && !otherMod && !event.altKey && !event.shiftKey;
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

      // A search field with a list under it: ↑ ↓ move, Enter picks
      if (
        plain &&
        target instanceof HTMLInputElement &&
        ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)
      ) {
        const choices = pickerOptions(target);
        if (choices.length) {
          event.preventDefault();
          const at = activeChoice ? choices.indexOf(activeChoice) : -1;
          if (event.key === "Enter") {
            const choice = at >= 0 ? choices[at] : choices[0];
            setActiveChoice(null);
            choice.click();
          } else if (event.key === "ArrowDown")
            setActiveChoice(choices[(at + 1) % choices.length]);
          else setActiveChoice(choices[at <= 0 ? choices.length - 1 : at - 1]);
          return;
        }
      }

      if (event.key === "Enter" && !event.altKey && !event.shiftKey && !otherMod) {
        // ⌘Enter saves
        if (mod) return press(event, shortcutButton(target, "save"));
        // Enter ticks a checkbox in a list or menu
        if (
          target instanceof HTMLInputElement &&
          (target.type === "checkbox" || target.type === "radio") &&
          !target.form
        )
          return press(event, target);
        // Enter in a one-line field confirms
        if (isConfirmField(target)) press(event, shortcutButton(target, "next"));
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
      )
        return;

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
      // "?" and "/" may need Shift; letters never do
      if (event.shiftKey || event.key.length !== 1) return;

      const pageShortcut = pageShortcuts.findLast((s) => s.key === key);
      if (pageShortcut) {
        event.preventDefault();
        pageShortcut.run();
        return;
      }
      const menuKeys: Record<string, MenuName> = { a: "add", g: "go", y: "copy", e: "edit", r: "reading" };
      // E and R open only where the page has edit or reading actions
      if (menuKeys[key] === "edit" && editItems().length === 0) return;
      if (menuKeys[key] === "reading" && readingItems().length === 0) return;
      if (menuKeys[key]) {
        event.preventDefault();
        openMenu(menuKeys[key]);
      }
    }

    // Window, bubble phase: page handlers run first and can take a key
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname, paletteOpen, onPaletteOpenChange, pageShortcuts, editItems, readingItems]);

  const closeAddDialog = () => setAddDialog(null);

  return (
    <ShortcutsContext.Provider value={context}>
      {children}
      <ShortcutsHelp
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        pageShortcuts={pageShortcuts}
      />
      {/* Mounted only while open, so each opens with an empty form */}
      {addDialog === "author" && (
        <AuthorCreateDialog open onOpenChange={(open) => !open && closeAddDialog()} />
      )}
      {addDialog === "recommender" && (
        <RecommenderFormDialog open onClose={closeAddDialog} />
      )}
      {addDialog === "series" && <SeriesFormDialog open onClose={closeAddDialog} />}
      {addDialog === "collection" && (
        <CreateCollectionDialog open onOpenChange={(open) => !open && closeAddDialog()} />
      )}
      {addDialog === "place" && (
        <VenueCreateDialog open onOpenChange={(open) => !open && closeAddDialog()} />
      )}
      {menu && (
        <LeaderMenu
          title={MENU_TITLES[menu]}
          items={menuItems}
          active={menuIndex}
          onActiveChange={setMenuIndex}
          onPick={(index) => pickMenuItem(menu, index)}
          onClose={() => setMenu(null)}
        />
      )}
    </ShortcutsContext.Provider>
  );
}
