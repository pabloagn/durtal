"use client";

import { useEffect, useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Building2,
  MapPin,
  Search,
  Keyboard,
  Loader2,
  RotateCw,
  Copy,
  Link2,
  BookMarked,
  BookOpen,
  BookPlus,
  CalendarClock,
  ListOrdered,

  Sparkles,
  NotebookText,
  Quote,
  Square,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { KeyCombo, Kbd } from "@/components/shortcuts/kbd";
import { CapAligned } from "@/components/shared/cap-aligned";
import { useShortcutActions } from "@/components/shortcuts/shortcuts-provider";
import { quickSearch, getPaletteContinueReading, type QuickSearchResult } from "@/lib/actions/quick-search";
import { ADD, COPY_KEYS, GO_TO, SHORTCUTS, type Keys } from "@/lib/shortcuts/shortcuts";
import { SECTION_ICONS } from "@/components/shortcuts/section-icons";
import { filterBySearch } from "@/lib/utils/search-text";
import { DOMAIN_SECTIONS, NAV_SECTIONS } from "@/lib/navigation";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { SETTINGS_SECTIONS } from "@/components/settings/sections";
import { monogramTint } from "@/components/shared/no-photo";
import { useReadingDialogs } from "@/components/reading/reading-dialogs-provider";
import { useOptionalTimer } from "@/components/reading/timer-provider";
import { useStopTimer } from "@/components/reading/timer-chip";
import { getOpenReadings } from "@/lib/actions/reading";
import { paletteReadingItems, queryNamesATitle, type PaletteOpenReading } from "@/lib/reading/palette";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";
import { mediaUrl } from "@/lib/s3/media-url";
import { PaletteEbookReadAction } from "@/components/ebooks/catalogue-read-action";
import { ebookPaletteGroup } from "@/lib/ebooks/palette-group";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";
import { readerEntryHref } from "@/lib/reader/entry-policy";
import { isComposing } from "@/lib/shortcuts/shortcuts";
import { leavePage } from "@/components/ui/unsaved-guard";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shared Continue query output, fetched by the owner adapter when opened. */
  recentEbook?: WorkEbookDTO | null;
  readerReturnTo?: string;
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
  { label: "Keyboard shortcuts", run: "help", icon: Keyboard, keys: SHORTCUTS.help },
];

const NO_RESULTS: QuickSearchResult = { works: [], people: [], organizations: [], venues: [] };

/** The open collections, in navigation order: one group of results each */
const RESULT_KINDS = getEnabledWorkKinds();

/**
 * A result's picture: the work's cover or poster, 24x36 like a small card, or
 * the person's portrait, 28px square. Both sit on a 36px row, so every row keeps
 * one height. The box is fixed, so the list never moves while it loads. With
 * no picture, a work shows its title's letter as every blank cover does
 * (`CoverLetter`), and a person the initials on the tint taken from the name,
 * as on the cards. The initials' line is trimmed to the cap height, as the
 * letter's is, so the box centers the capitals: the serif's line box would
 * put them 1px above the middle.
 */
function ResultThumb({ src, name, kind }: { src: string | null; name: string; kind: "book" | "author" }) {
  const words = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0]?.[0] ?? "?");
  const frame = kind === "book" ? "h-9 w-6" : "size-7";
  const blankWork = !src && kind === "book";
  return (
    <span className="flex h-9 shrink-0 items-center">
      <span
        className={`relative ${frame} overflow-hidden rounded-[2px] bg-bg-tertiary ring-1 ring-glass-border ${blankWork ? COVER_BLANK : "flex items-center justify-center"}`}
        style={src || blankWork ? undefined : monogramTint(name)}
      >
        {src ? (
          <img
            src={mediaUrl(src)}
            alt=""
            loading="lazy"
            decoding="async"
            className={`protected-image absolute inset-0 h-full w-full object-cover ${kind === "author" ? "object-[50%_25%]" : ""}`}
          />
        ) : blankWork ? (
          <CoverLetter title={name} />
        ) : (
          <span aria-hidden="true" className="font-serif text-micro leading-none text-fg-primary [text-box:trim-both_cap_alphabetic]">
            {initials.toUpperCase()}
          </span>
        )}
      </span>
    </span>
  );
}

const GROUP_CLASS =
  "text-xs font-medium text-fg-secondary [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5";
// 44px rows on touch, like every other control a finger presses: from
// padding around the 24px line, not a minimum height, so a one-line label
// sits at the top of the row, on the icon's line (SLN-849)
const ITEM_CLASS =
  "group flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 pointer-coarse:py-2.5 text-sm text-fg-secondary transition-colors aria-selected:bg-selection-bg/60 aria-selected:text-fg-primary";

// A row's words wrap in full at every width, never cut: a title, a person's
// or a house's roles, a command (pass 5, SLN-849)
const LABEL_CLASS = "min-w-0 flex-1 break-words";
/** An icon on the first line of a row that wraps */
function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <CapAligned height={16} className="self-start">
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </CapAligned>
  );
}

export function CommandPalette({ open, onOpenChange, recentEbook, readerReturnTo }: CommandPaletteProps) {
  const router = useRouter();
  const actions = useShortcutActions();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [results, setResults] = useState<QuickSearchResult>(NO_RESULTS);
  const [searching, setSearching] = useState(false);
  // A search that failed says so, with a way to run it again (SLN-752)
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // A shorter placeholder on a phone, where the long one was cut
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 639px)");
    if (!query) return;
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  const [recentFromQuery, setRecentFromQuery] = useState<WorkEbookDTO | null>(null);

  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false);
      leavePage(() =>
        startTransition(() => {
          router.push(href);
        }),
      );
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

  // The open readings, fetched each time the palette opens, never with the page
  const reading = useReadingDialogs();
  const timer = useOptionalTimer();
  const stopTimer = useStopTimer();
  const [openReadings, setOpenReadings] = useState<PaletteOpenReading[]>([]);
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(NO_RESULTS);
      setRecentFromQuery(null);
      return;
    }
    let live = true;
    getOpenReadings()
      .then((rows) => live && setOpenReadings(rows))
      .catch(() => live && setOpenReadings([]));
    if (recentEbook === undefined) getPaletteContinueReading()
      .then((ebook) => live && setRecentFromQuery(ebook))
      .catch(() => live && setRecentFromQuery(null));
    return () => {
      live = false;
    };
  }, [open, recentEbook]);

  // Works of every open collection, people, organizations and places; an
  // older answer never replaces a newer one
  const trimmed = query.trim();
  const returnDestination = readerReturnTo ?? (typeof window !== "undefined"
    ? `${window.location.pathname}${window.location.search}${window.location.hash}`
    : null);
  const ebookGroup = ebookPaletteGroup({
    works: results.works.map((work) => ({ id: work.id, kind: work.kind, ebook: work.ebook ?? null })),
    ebooks: results.ebooks ?? [],
    recent: recentEbook === undefined ? recentFromQuery : recentEbook,
    emptyQuery: !trimmed,
  });
  function readEbook(path: string) {
    const href = readerEntryHref(path, returnDestination);
    if (!href) return;
    onOpenChange(false);
    window.location.assign(href);
  }
  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(NO_RESULTS);
      setSearching(false);
      setFailed(false);
      return;
    }
    let stale = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await quickSearch(trimmed);
        if (!stale) {
          setResults(found);
          setFailed(false);
        }
      } catch {
        if (!stale) {
          setResults(NO_RESULTS);
          setFailed(true);
        }
      } finally {
        if (!stale) setSearching(false);
      }
    }, 120);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [trimmed, attempt]);

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
  // Where the open item takes A then F or A then C (SLN-571), its Add entry
  // shows no keys: they favourite the item or open its collections
  const itemKeys = actions.itemKeys();
  const allActionItems = itemKeys.length
    ? ACTION_ITEMS.map((i) => (i.add && itemKeys.includes(i.add) ? { ...i, keys: undefined, then: undefined } : i))
    : ACTION_ITEMS;
  const actionItems = trimmed
    ? filterBySearch(allActionItems, trimmed, (i) => i.label)
    : allActionItems;
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
    // The timer (SLN-451): Stop while one runs, else Start on each open reading
    ...(timer?.timer
      ? [{ value: "reading:timer-stop", label: `Stop timer · ${timer.timer.title}`, icon: Square, run: () => stopTimer() }]
      : timer
        ? openReadings.map((o) => ({
            value: `reading:timer:${o.reading.id}`,
            label: `Start timer · ${o.work.title}`,
            icon: Timer,
            run: () => void timer.start({ readingId: o.reading.id, workId: o.work.id, title: o.work.title }),
          }))
        : []),
    { value: "reading:start", label: "Start reading...", icon: BookPlus, run: () => reading.pick("start") },
    { value: "reading:past", label: "Log a past read...", icon: CalendarClock, run: () => reading.pick("past") },
    // Quotes (SLN-453): one per open reading, then any book through the picker
    ...openReadings.map((o) => ({
      value: `reading:quote:${o.reading.id}`,
      label: `Add a quote · ${o.work.title}`,
      icon: Quote,
      run: () => void reading.open({ kind: "note", workId: o.work.id, readingId: o.reading.id, noteKind: "quote" }),
    })),
    { value: "reading:quote", label: "Add a quote...", icon: Quote, run: () => reading.pick("quote") },
    { value: "reading:notes", label: "Go to Notes", icon: NotebookText, run: () => navigate("/reading/notes") },
    // Up Next (SLN-452); "Add to Up Next" on a book page comes from its R menu under "This page"
    { value: "reading:next", label: "Go to Up next", icon: ListOrdered, run: () => navigate("/reading/next") },
    // Suggestions (SLN-457): Pick one for me
    { value: "reading:suggest", label: "Suggest a book", icon: Sparkles, run: () => navigate("/reading/suggestions?pick=1") },
  ];
  const readingItems = trimmed ? filterBySearch(allReadingItems, trimmed, (i) => i.label) : allReadingItems;
  const firstValue =
    (smartFirst && smartItems[0] && smartItems[0].value) ||
    (results.works[0] && `work:${results.works[0].id}`) ||
    (ebookGroup.ebooks[0] && `ebook:${ebookGroup.ebooks[0].id}`) ||
    (ebookGroup.continueReading && "ebook:continue") ||
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
          onKeyDownCapture={(event) => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || isComposing(event.nativeEvent)) return;
            const workId = selected.startsWith("work:") ? selected.slice(5) : null;
            const path = workId ? ebookGroup.bookReaderPaths.get(workId) : null;
            if (!path || !readerEntryHref(path, returnDestination)) return;
            event.preventDefault();
            event.stopPropagation();
            readEbook(path);
          }}
        >
          <div className="flex items-center border-b border-glass-border px-4">
            <Search className="mr-2 h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.5} />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder={narrow ? "Search, or type a command…" : "Search the catalogue, or type a command…"}
              className="h-11 w-full bg-transparent text-sm text-fg-primary outline-none placeholder:text-fg-muted"
              autoFocus
            />
            {searching && (
              <span role="status" className="contents">
                <Loader2
                  aria-hidden="true"
                  className="ml-2 h-4 w-4 shrink-0 animate-spin text-fg-muted"
                  strokeWidth={1.5}
                />
                <span className="sr-only">Searching</span>
              </span>
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
                      {/* On a phone the author is a second line; both wrap in full */}
                      <span className={LABEL_CLASS}>
                        {work.title}
                        {work.creators.length > 0 && (
                          <span className="text-fg-secondary max-sm:block">
                            <span className="max-sm:hidden">{"\u00a0· "}</span>
                            {work.creators.slice(0, 2).join(", ")}
                          </span>
                        )}
                      </span>
                      {work.year && (
                        <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
                          {work.year}
                        </span>
                      )}
                      {work.kind === "book" && (
                        <PaletteEbookReadAction ebook={work.ebook ?? null} returnTo={returnDestination} onRead={() => onOpenChange(false)} />
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}

            {!smartFirst && smartGroup}

            {(ebookGroup.ebooks.length > 0 || ebookGroup.continueReading) && (
              <Command.Group heading="eBooks" className={GROUP_CLASS}>
                {ebookGroup.continueReading && (
                  <Command.Item value="ebook:continue" className={ITEM_CLASS} onSelect={() => readEbook(ebookGroup.continueReading!.readerPath!)}>
                    <RowIcon icon={BookOpen} />
                    <span className={LABEL_CLASS}>{ebookGroup.continueReading.title}</span>
                  </Command.Item>
                )}
                {ebookGroup.ebooks.map((ebook) => (
                  <Command.Item key={ebook.id} value={`ebook:${ebook.id}`} className={ITEM_CLASS} onSelect={() => navigate(ebook.href)}>
                    <RowIcon icon={BookOpen} />
                    <span className={LABEL_CLASS}>{ebook.title}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

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
                    <span className={LABEL_CLASS}>
                      {person.name}
                      {person.roles && (
                        <span className="text-fg-secondary max-sm:block">
                          <span className="max-sm:hidden">{"\u00a0· "}</span>
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
                    <RowIcon icon={Building2} />
                    <span className={LABEL_CLASS}>
                      {organization.name}
                      {organization.roles && (
                        <span className="text-fg-secondary max-sm:block">
                          <span className="max-sm:hidden">{"\u00a0· "}</span>
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
                    <RowIcon icon={MapPin} />
                    <span className={LABEL_CLASS}>
                      {venue.name}
                      <span className="text-fg-secondary max-sm:block">
                        <span className="max-sm:hidden">{"\u00a0· "}</span>
                        {venue.type}
                      </span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {trimmed && !searching && failed && (
              <Command.Group heading="Search failed" className={GROUP_CLASS} data-palette-failed="">
                <p role="status" className="px-2 pb-1.5 text-sm text-fg-secondary">
                  The catalogue could not be searched.
                </p>
                <Command.Item
                  value="search:again"
                  onSelect={() => {
                    setAttempt((n) => n + 1);
                    // A click keeps typing in the field, as Enter does
                    inputRef.current?.focus();
                  }}
                  className={ITEM_CLASS}
                >
                  <RowIcon icon={RotateCw} />
                  <span className={LABEL_CLASS}>Search again</span>
                </Command.Item>
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
                    <RowIcon icon={Search} />
                    <span className={LABEL_CLASS}>
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
      <RowIcon icon={item.icon} />
      <span className={LABEL_CLASS}>{item.label}</span>
      {item.keys && <KeyCombo keys={item.keys} then={item.then} />}
    </Command.Item>
  );
}
