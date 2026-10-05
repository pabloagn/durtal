"use client";

import { useEffect, useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Building2,
  Library,
  MapPin,
  Search,
  Keyboard,
  Loader2,
  Copy,
  Link2,
  BookMarked,
  BookPlus,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { KeyCombo, Kbd } from "@/components/shortcuts/kbd";
import { useShortcutActions } from "@/components/shortcuts/shortcuts-provider";
import { quickSearch, type QuickSearchResult } from "@/lib/actions/quick-search";
import { ADD, COPY_KEYS, GO_TO, SHORTCUTS, type Keys } from "@/lib/shortcuts/shortcuts";
import { SECTION_ICONS } from "@/components/shortcuts/section-icons";
import { filterBySearch } from "@/lib/utils/search-text";
import { DOMAIN_SECTIONS, NAV_SECTIONS } from "@/lib/navigation";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { SETTINGS_SECTIONS } from "@/components/settings/sections";
import { monogramTint } from "@/components/shared/no-photo";
import { useReadingDialogs } from "@/components/reading/reading-dialogs-provider";
import { getOpenReadings } from "@/lib/actions/reading";
import { paletteReadingItems, queryNamesATitle, type PaletteOpenReading } from "@/lib/reading/palette";

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
  /** The shortcut sheet, or any action (the reading dialogs) */
  run?: "help" | (() => void);
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

const NO_RESULTS: QuickSearchResult = { works: [], people: [], organizations: [], venues: [] };

/** The open collections, in navigation order: one group of results each */
const RESULT_KINDS = getEnabledWorkKinds();

const imageUrl = (key: string) => `/api/s3/read?key=${encodeURIComponent(key)}`;

/**
 * A result's picture: the work's cover or poster, 24x36 like a small card, or
 * the person's portrait, 28px square. Both sit on a 36px row, so every row keeps
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
    else if (typeof item.run === "function") item.run();
  }

  // However the palette closes (Esc, a pick, the backdrop), focus goes back
  // to what had it when the palette opened (SLN-477); a pick that opens a
  // dialog moves it on into the dialog
  useEffect(() => {
    if (!open) return;
    const origin = document.activeElement;
    return () => {
      if (origin instanceof HTMLElement && origin !== document.body && origin.isConnected)
        origin.focus({ preventScroll: true });
    };
  }, [open]);

  // The open readings, fetched each time the palette opens, never with the page
  const reading = useReadingDialogs();
  const [openReadings, setOpenReadings] = useState<PaletteOpenReading[]>([]);
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(NO_RESULTS);
      return;
    }
    let live = true;
    getOpenReadings()
      .then((rows) => live && setOpenReadings(rows))
      .catch(() => live && setOpenReadings([]));
    return () => {
      live = false;
    };
  }, [open]);

  // Works of every open collection, people, organizations and places; an
  // older answer never replaces a newer one
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
  // The page's E and R entries, each with its full label ("Edit work", "Log progress")
  const allPageActions = [
    ...actions.editItems().map((i) => ({ ...i, value: `edit:${i.key}`, phrase: `Edit ${i.label.toLowerCase()}`, keys: ["e", i.key] })),
    ...actions.readingItems().map((i) => ({ ...i, value: `reading:${i.key}`, phrase: i.label, keys: ["r", i.key] })),
  ];
  const pageActions = trimmed ? filterBySearch(allPageActions, trimmed, (i) => i.phrase) : allPageActions;
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
  // "212" logs page 212: those items come first; then the Reading group.
  // "451" opens Fahrenheit 451 first: a found title with the number as a word
  // puts the books before the log items
  const { smart: smartItems, log: logItems } = paletteReadingItems(trimmed, openReadings);
  const smartFirst = !queryNamesATitle(
    trimmed,
    results.works.map((work) => work.title),
  );
  const allReadingItems: (PaletteItem & { value: string })[] = [
    ...logItems.map((item) => ({ value: item.value, label: item.label, icon: BookMarked, run: () => void reading.open(item.request) })),
    { value: "reading:start", label: "Start reading...", icon: BookPlus, run: () => reading.pick("start") },
    { value: "reading:past", label: "Log a past read...", icon: CalendarClock, run: () => reading.pick("past") },
  ];
  const readingItems = trimmed ? filterBySearch(allReadingItems, trimmed, (i) => i.label) : allReadingItems;
  const firstValue =
    (smartFirst && smartItems[0] && smartItems[0].value) ||
    (results.works[0] && `work:${results.works[0].id}`) ||
    (smartItems[0] && smartItems[0].value) ||
    (results.people[0] && `person:${results.people[0].id}`) ||
    (results.organizations[0] && `org:${results.organizations[0].id}`) ||
    (results.venues[0] && `venue:${results.venues[0].id}`) ||
    (pageActions[0] && pageActions[0].value) ||
    (copyItems[0] && `copy:${copyItems[0].key}`) ||
    (readingItems[0] && readingItems[0].value) ||
    (actionItems[0] && `action:${actionItems[0].label}`) ||
    (navigationItems[0] && `nav:${navigationItems[0].label}`) ||
    (trimmed && DOMAIN_SECTIONS[0] && `search:${DOMAIN_SECTIONS[0].href}`) ||
    "";

  // The best match is selected, so Enter opens it
  useEffect(() => {
    setSelected(firstValue);
  }, [firstValue]);

  if (!open) return null;

  const smartGroup = smartItems.length > 0 && (
    <Command.Group heading="Log progress" className={GROUP_CLASS}>
      {smartItems.map((item) => (
        <PaletteRow
          key={item.value}
          item={{ label: item.label, icon: BookMarked }}
          value={item.value}
          onSelect={() => {
            onOpenChange(false);
            void reading.open(item.request);
          }}
        />
      ))}
    </Command.Group>
  );

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
              placeholder="Search the catalogue, or type a command..."
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
            {smartFirst && smartGroup}

            {RESULT_KINDS.map((kind) => {
              const works = results.works.filter((work) => work.kind === kind);
              if (!works.length) return null;
              return (
                <Command.Group key={kind} heading={WORK_DOMAINS[kind].pluralLabel} className={GROUP_CLASS}>
                  {works.map((work) => (
                    <Command.Item
                      key={work.id}
                      value={`work:${work.id}`}
                      onSelect={() => navigate(work.href)}
                      className={ITEM_CLASS}
                    >
                      <ResultThumb src={work.cover} name={work.title} kind="book" />
                      <span className="min-w-0 flex-1 truncate">
                        {work.title}
                        {work.creators.length > 0 && (
                          <span className="text-fg-secondary">
                            {"  ·  "}
                            {work.creators.slice(0, 2).join(", ")}
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
              );
            })}

            {!smartFirst && smartGroup}

            {results.people.length > 0 && (
              <Command.Group heading="People" className={GROUP_CLASS}>
                {results.people.map((person) => (
                  <Command.Item
                    key={person.id}
                    value={`person:${person.id}`}
                    onSelect={() => navigate(person.href)}
                    className={ITEM_CLASS}
                  >
                    <ResultThumb src={person.photo} name={person.name} kind="author" />
                    <span className="min-w-0 flex-1 truncate">
                      {person.name}
                      {person.roles && (
                        <span className="text-fg-secondary">
                          {"  ·  "}
                          {person.roles}
                        </span>
                      )}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {results.organizations.length > 0 && (
              <Command.Group heading="Organizations" className={GROUP_CLASS}>
                {results.organizations.map((organization) => (
                  <Command.Item
                    key={organization.id}
                    value={`org:${organization.id}`}
                    onSelect={() => navigate(organization.href)}
                    className={ITEM_CLASS}
                  >
                    <Building2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1 truncate">
                      {organization.name}
                      {organization.roles && (
                        <span className="text-fg-secondary">
                          {"  ·  "}
                          {organization.roles}
                        </span>
                      )}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {results.venues.length > 0 && (
              <Command.Group heading="Places" className={GROUP_CLASS}>
                {results.venues.map((venue) => (
                  <Command.Item
                    key={venue.id}
                    value={`venue:${venue.id}`}
                    onSelect={() => navigate(venue.href)}
                    className={ITEM_CLASS}
                  >
                    <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1 truncate">
                      {venue.name}
                      <span className="text-fg-secondary">
                        {"  ·  "}
                        {venue.type}
                      </span>
                    </span>
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

            {(pageActions.length > 0 || copyItems.length > 0) && (
              <Command.Group heading="This page" className={GROUP_CLASS}>
                {pageActions.map((item) => (
                  <PaletteRow
                    key={item.value}
                    item={{
                      label: item.phrase,
                      icon: item.icon,
                      keys: item.keys,
                      then: true,
                    }}
                    value={item.value}
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

            {readingItems.length > 0 && (
              <Command.Group heading="Reading" className={GROUP_CLASS}>
                {readingItems.map((item) => (
                  <PaletteRow key={item.value} item={item} value={item.value} onSelect={() => runItem(item)} />
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
