"use client";

import { useEffect, useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Library,
  Search,
  Keyboard,
  Loader2,
  Copy,
  Link2,
  type LucideIcon,
} from "lucide-react";
import { KeyCombo, Kbd } from "@/components/shortcuts/kbd";
import { useShortcutActions } from "@/components/shortcuts/shortcuts-provider";
import { quickSearch, type QuickSearchResult } from "@/lib/actions/quick-search";
import { ADD, COPY_KEYS, GO_TO, SHORTCUTS, type Keys } from "@/lib/shortcuts/shortcuts";
import { SECTION_ICONS } from "@/components/shortcuts/section-icons";
import { filterBySearch } from "@/lib/utils/search-text";
import { DOMAIN_SECTIONS, NAV_SECTIONS } from "@/lib/navigation";
import { SETTINGS_SECTIONS } from "@/components/settings/sections";
import { monogramTint } from "@/components/shared/no-photo";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PaletteItem {
  label: string;
  icon: LucideIcon;
  keys?: Keys;
  then?: boolean;
  href?: string;
  /** An "Add" entry's key: "b" adds a book */
  add?: string;
  run?: "help";
}

const NAVIGATION_ITEMS: PaletteItem[] = NAV_SECTIONS.map((item) => {
  const go = GO_TO.find((g) => g.href === item.href);
  return {
    ...item,
    icon: SECTION_ICONS[item.href],
    keys: go ? ["g", go.key] : undefined,
    then: true,
  };
});

/** The parts of Settings past its first (General, which is "Settings" above): found by search */
const SETTINGS_ITEMS: PaletteItem[] = SETTINGS_SECTIONS.slice(1).map((section) => ({
  label: `Settings: ${section.label}`,
  icon: section.icon,
  href: section.href,
}));

const ACTION_ITEMS: PaletteItem[] = [
  ...ADD.map((a) => ({
    label: `Add ${/^[aeiou]/i.test(a.label) ? "an" : "a"} ${a.label.toLowerCase()}`,
    add: a.key,
    icon: SECTION_ICONS[a.section],
    keys: ["a", a.key],
    then: true,
  })),
  { label: "Import books", href: "/library/import", icon: Library },
  { label: "Keyboard shortcuts", run: "help", icon: Keyboard, keys: SHORTCUTS.help },
];

const NO_RESULTS: QuickSearchResult = { works: [], authors: [] };

const imageUrl = (key: string) => `/api/s3/read?key=${encodeURIComponent(key)}`;

/**
 * A result's picture: the book's cover, 24x36 like a small card, or the
 * author's portrait, 28px square. Both sit on a 36px row, so every row keeps
 * one height. The box is fixed, so the list never moves while it loads; with
 * no picture, the box shows the initials on the tint taken from the name, as
 * on the cards.
 */
function ResultThumb({ src, name, kind }: { src: string | null; name: string; kind: "book" | "author" }) {
  const words = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0]?.[0] ?? "?");
  const frame = kind === "book" ? "h-9 w-6" : "size-7";
  return (
    <span className="flex h-9 shrink-0 items-center">
      <span
        className={`relative flex ${frame} items-center justify-center overflow-hidden rounded-[2px] bg-bg-tertiary ring-1 ring-glass-border`}
        style={src ? undefined : monogramTint(name)}
      >
        {src ? (
          <img
            src={imageUrl(src)}
            alt=""
            loading="lazy"
            decoding="async"
            className={`protected-image absolute inset-0 h-full w-full object-cover ${kind === "author" ? "object-[50%_25%]" : ""}`}
          />
        ) : (
          <span aria-hidden="true" className="font-serif text-micro text-fg-primary">
            {initials.toUpperCase()}
          </span>
        )}
      </span>
    </span>
  );
}

const GROUP_CLASS =
  "text-xs font-medium text-fg-secondary [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5";
const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-fg-secondary transition-colors aria-selected:bg-accent-plum/60 aria-selected:text-fg-primary";

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const actions = useShortcutActions();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [results, setResults] = useState<QuickSearchResult>(NO_RESULTS);
  const [searching, setSearching] = useState(false);

  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false);
      startTransition(() => {
        router.push(href);
      });
    },
    [router, onOpenChange],
  );

  function runItem(item: PaletteItem) {
    if (item.href) return navigate(item.href);
    onOpenChange(false);
    if (item.add) actions.add(item.add);
    if (item.run === "help") actions.openHelp();
  }

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(NO_RESULTS);
    }
  }, [open]);

  // Books and authors from the catalogue; an older answer never replaces a newer one
  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(NO_RESULTS);
      setSearching(false);
      return;
    }
    let stale = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await quickSearch(trimmed);
        if (!stale) setResults(found);
      } catch {
        if (!stale) setResults(NO_RESULTS);
      } finally {
        if (!stale) setSearching(false);
      }
    }, 120);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  // "This page" shows when the page has its own entries, or when searched
  const allEditItems = actions.editItems();
  const editItems = trimmed
    ? filterBySearch(allEditItems, trimmed, (i) => `Edit ${i.label}`)
    : allEditItems;
  const allCopyItems = actions.copyItems();
  const copyItems = trimmed
    ? filterBySearch(allCopyItems, trimmed, (i) => `Copy ${i.label}`)
    : allCopyItems.length > 1
      ? allCopyItems
      : [];
  const actionItems = trimmed
    ? filterBySearch(ACTION_ITEMS, trimmed, (i) => i.label)
    : ACTION_ITEMS;
  const navigationItems = trimmed
    ? filterBySearch([...NAVIGATION_ITEMS, ...SETTINGS_ITEMS], trimmed, (i) => i.label)
    : NAVIGATION_ITEMS;
  const firstValue =
    (results.works[0] && `work:${results.works[0].id}`) ||
    (results.authors[0] && `author:${results.authors[0].id}`) ||
    (editItems[0] && `edit:${editItems[0].key}`) ||
    (copyItems[0] && `copy:${copyItems[0].key}`) ||
    (actionItems[0] && `action:${actionItems[0].label}`) ||
    (navigationItems[0] && `nav:${navigationItems[0].label}`) ||
    (trimmed && DOMAIN_SECTIONS[0] && `search:${DOMAIN_SECTIONS[0].href}`) ||
    "";

  // The best match is selected, so Enter opens it
  useEffect(() => {
    setSelected(firstValue);
  }, [firstValue]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 glass-veil"
        onClick={() => onOpenChange(false)}
      />

      {/* Palette */}
      <div className="absolute left-1/2 top-[20%] w-full max-w-xl -translate-x-1/2 px-4">
        <Command
          className="glass relative overflow-hidden"
          shouldFilter={false}
          value={selected}
          onValueChange={setSelected}
          loop
        >
          <div className="flex items-center border-b border-glass-border px-4">
            <Search className="mr-2 h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.5} />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search books and people, or type a command..."
              className="h-11 w-full bg-transparent text-sm text-fg-primary outline-none placeholder:text-fg-muted"
              autoFocus
            />
            {searching && (
              <Loader2
                className="ml-2 h-4 w-4 shrink-0 animate-spin text-fg-muted"
                strokeWidth={1.5}
              />
            )}
          </div>

          <Command.List className="max-h-96 overflow-y-auto p-2">
            {results.works.length > 0 && (
              <Command.Group heading="Books" className={GROUP_CLASS}>
                {results.works.map((work) => (
                  <Command.Item
                    key={work.id}
                    value={`work:${work.id}`}
                    onSelect={() => navigate(`/library/${work.slug}`)}
                    className={ITEM_CLASS}
                  >
                    <ResultThumb src={work.cover} name={work.title} kind="book" />
                    <span className="min-w-0 flex-1 truncate">
                      {work.title}
                      {work.authors.length > 0 && (
                        <span className="text-fg-secondary">
                          {"  ·  "}
                          {work.authors.slice(0, 2).join(", ")}
                        </span>
                      )}
                    </span>
                    {work.year && (
                      <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
                        {work.year}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {results.authors.length > 0 && (
              <Command.Group heading="People" className={GROUP_CLASS}>
                {results.authors.map((author) => (
                  <Command.Item
                    key={author.id}
                    value={`author:${author.id}`}
                    onSelect={() => navigate(`/people/${author.slug}`)}
                    className={ITEM_CLASS}
                  >
                    <ResultThumb src={author.photo} name={author.name} kind="author" />
                    <span className="min-w-0 flex-1 truncate">{author.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {trimmed && !searching && (
              <Command.Group heading="Search" className={GROUP_CLASS}>
                {DOMAIN_SECTIONS.map((domain) => (
                  <Command.Item
                    key={domain.href}
                    value={`search:${domain.href}`}
                    onSelect={() =>
                      navigate(`${domain.href}?q=${encodeURIComponent(trimmed)}`)
                    }
                    className={ITEM_CLASS}
                  >
                    <Search className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1 truncate">
                      Search {domain.label.toLowerCase()} for &ldquo;{trimmed}&rdquo;
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {(editItems.length > 0 || copyItems.length > 0) && (
              <Command.Group heading="This page" className={GROUP_CLASS}>
                {editItems.map((item) => (
                  <PaletteRow
                    key={`edit:${item.key}`}
                    item={{
                      label: `Edit ${item.label.toLowerCase()}`,
                      icon: item.icon,
                      keys: ["e", item.key],
                      then: true,
                    }}
                    value={`edit:${item.key}`}
                    onSelect={() => {
                      onOpenChange(false);
                      item.run();
                    }}
                  />
                ))}
                {copyItems.map((item) => (
                  <PaletteRow
                    key={item.key}
                    item={{
                      label: `Copy ${item.label.toLowerCase()}`,
                      icon: item.key === COPY_KEYS.link ? Link2 : Copy,
                      keys: ["y", item.key],
                      then: true,
                    }}
                    value={`copy:${item.key}`}
                    onSelect={() => {
                      onOpenChange(false);
                      void actions.copy(item);
                    }}
                  />
                ))}
              </Command.Group>
            )}

            {actionItems.length > 0 && (
              <Command.Group heading="Actions" className={GROUP_CLASS}>
                {actionItems.map((item) => (
                  <PaletteRow
                    key={item.label}
                    item={item}
                    value={`action:${item.label}`}
                    onSelect={() => runItem(item)}
                  />
                ))}
              </Command.Group>
            )}

            {navigationItems.length > 0 && (
              <Command.Group heading="Go to" className={GROUP_CLASS}>
                {navigationItems.map((item) => (
                  <PaletteRow
                    key={item.label}
                    item={item}
                    value={`nav:${item.label}`}
                    onSelect={() => runItem(item)}
                  />
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="flex items-center gap-4 border-t border-glass-border px-4 py-2 text-micro text-fg-secondary">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              open
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function PaletteRow({
  item,
  value,
  onSelect,
}: {
  item: PaletteItem;
  value: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={ITEM_CLASS}>
      <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.keys && <KeyCombo keys={item.keys} then={item.then} />}
    </Command.Item>
  );
}
