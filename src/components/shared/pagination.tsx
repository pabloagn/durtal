"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CapAligned } from "@/components/shared/cap-aligned";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import {
  getPageRange,
  lastPage,
  PAGE_SIZES,
  pageHref,
} from "@/lib/utils/pagination";
import {
  perPageCookieName,
  readCookie,
  writeCookie,
} from "@/lib/utils/preference-cookies";

export interface PaginationData {
  page: number;
  perPage: number;
  total: number;
}
/** Nouns whose one is not the plural without its "s" */
const ONE: Record<string, string> = { people: "person", series: "series", "quotes and notes": "quote or note" };

/** The pager's noun for its total: "of 1 publisher", "of 2 publishers" */
export function pagerNoun(noun: string, total: number) {
  return total === 1 ? (ONE[noun] ?? noun.replace(/s$/, "")) : noun;
}

interface Props extends PaginationData {
  /** The plural: "books", "people"; the pager says the one form for a total of 1 */
  noun: string;
  compact?: boolean;
  anchor?: string;
  /** The page sizes offered; with one or none, no size choice shows */
  sizes?: readonly number[];
  /** A control for the list, such as Select, at the end of the row (SLN-639) */
  action?: React.ReactNode;
}
/**
 * The pager control just used. A new page remounts the list and both pagers
 * (each list route keys its Suspense by the page), and the focused link went
 * with them: the focus fell to the page body (focus survey, cause 1). The new
 * page gives it back to the same control, so Enter again keeps paging: in the
 * pager above the list when it has one shown, since the new page opens at the
 * list's start, and otherwise in the pager below.
 */
let used: { list: string; control: string; at: number } | null = null;
const remember = (list: string, control: string) => {
  used = { list, control, at: Date.now() };
};
/** Where a control that is gone (Next on the last page) hands the focus */
const STAND_IN: Record<string, string[]> = {
  next: ["previous"],
  last: ["previous", "first"],
  previous: ["next"],
  first: ["next", "last"],
  // A phone's jump closes on the new page: its button opens it again
  jump: ["jump-toggle"],
};

const control =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-sm border border-glass-border px-2 text-xs text-fg-secondary hover:bg-bg-tertiary disabled:pointer-events-none disabled:opacity-60 pointer-coarse:h-11 pointer-coarse:min-w-11";

export function Pagination({
  page,
  perPage,
  total,
  noun,
  compact = false,
  anchor = "list-start",
  sizes = PAGE_SIZES,
  action,
}: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const totalPages = lastPage(total, perPage);
  const current = Math.min(page, totalPages);
  const [jump, setJump] = useState(String(current));
  const [mobileJump, setMobileJump] = useState(false);
  const jumpRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const query = params.toString();
  const href = (p: number, size?: number) =>
    `${pageHref(pathname, params, p, size)}#${anchor}`;
  const nav = useRef<HTMLElement>(null);

  // The control used on the page before. The pager above the list mounts
  // first and takes it when it shows that control (or its stand-in); a
  // control hidden at this width (the size above the list on a phone, a
  // closed jump) is passed over
  useEffect(() => {
    if (!used || used.list !== anchor || Date.now() - used.at > 10_000) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const shown = (n: string) =>
      [...(nav.current?.querySelectorAll<HTMLElement>(`[data-pager-control="${n}"]:not(:disabled)`) ?? [])].find(
        (el) => el.checkVisibility?.() ?? true,
      );
    const target = [used.control, ...(STAND_IN[used.control] ?? [])].map(shown).find(Boolean);
    if (!target) return;
    used = null;
    target.focus({ preventScroll: true });
  }, [anchor, current, perPage]);

  useEffect(() => {
    setJump(String(current));
  }, [current]);
  useEffect(() => {
    if (compact && window.location.hash === `#${anchor}`) {
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    }
  }, [compact, anchor, current, perPage]);
  // Older builds kept the page size in localStorage: move it to the cookie
  // that src/proxy.ts reads
  useEffect(() => {
    if (!compact) return;
    const legacyKey = `durtal-per-page:${pathname}`;
    try {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy === null) return;
      localStorage.removeItem(legacyKey);
      const name = perPageCookieName(pathname);
      if (readCookie(name) !== undefined) return;
      writeCookie(name, legacy);
      // The server did not have the size for this one load
      const search = new URLSearchParams(window.location.search);
      const saved = Number(legacy);
      if (
        !search.has("perPage") &&
        saved !== perPage &&
        PAGE_SIZES.some((n) => n === saved)
      ) {
        router.replace(pageHref(pathname, search, 1, saved), { scroll: false });
      }
    } catch {
      /* optional preference */
    }
  }, [compact, pathname, perPage, router]);

  useEffect(() => {
    if (!compact) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        target?.closest(
          "input,textarea,select,button,a,[contenteditable=true],[role=dialog],[role=slider]",
        )
      )
        return;
      const next = event.key === "]" || event.key === "ArrowRight";
      const previous = event.key === "[" || event.key === "ArrowLeft";
      if (
        (!next && !previous) ||
        (next && current === totalPages) ||
        (previous && current === 1)
      )
        return;
      event.preventDefault();
      router.push(
        `${pageHref(pathname, new URLSearchParams(query), current + (next ? 1 : -1))}#${anchor}`,
      );
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compact, current, totalPages, pathname, query, anchor, router]);

  function changeSize(size: number) {
    remember(anchor, "size");
    writeCookie(perPageCookieName(pathname), String(size));
    // Open the page that holds the first item shown now
    router.push(href(Math.floor(((current - 1) * perPage) / size) + 1, size));
  }
  function submitJump(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(jump);
    if (!Number.isFinite(value) || !jump.trim()) return;
    remember(anchor, "jump");
    router.push(href(Math.max(1, Math.min(totalPages, Math.trunc(value)))));
    setMobileJump(false);
  }
  // Above the list on a phone, the arrows alone (named by aria-label) and a
  // bare count: the count and the page controls share a row (SLN-639)
  const labelClass = compact ? "max-sm:hidden" : undefined;
  const wordsClass = compact ? "max-sm:sr-only" : undefined;
  function pageLink(
    p: number,
    label: string,
    icon: React.ReactNode,
    disabled: boolean,
    rel?: "prev" | "next",
  ) {
    const name = label.toLowerCase();
    return disabled ? (
      <button type="button" className={control} disabled aria-label={label} data-pager-control={name}>
        <CapAligned height={14}>{icon}</CapAligned>
        <span className={labelClass}>{label}</span>
      </button>
    ) : (
      <Link className={control} href={href(p)} rel={rel} aria-label={label} data-pager-control={name} onClick={() => remember(anchor, name)}>
        <CapAligned height={14}>{icon}</CapAligned>
        <span className={labelClass}>{label}</span>
      </Link>
    );
  }
  const jumpForm = (
    <form onSubmit={submitJump} className="flex items-center gap-2">
      <label htmlFor={`${id}-jump`} className="text-xs text-fg-secondary">
        Go to page
      </label>
      <input
        ref={jumpRef}
        id={`${id}-jump`}
        type="number"
        inputMode="numeric"
        step="1"
        value={jump}
        onChange={(e) => setJump(e.target.value)}
        className={`${control} w-16 bg-bg-primary font-mono`}
        data-pager-control="jump"
      />
      <button type="submit" className={control}>
        Go
      </button>
    </form>
  );

  // An empty list shows its empty state alone
  if (total === 0) return null;
  // When every item fits on one page there is nowhere to go: no arrows, page
  // numbers or "Go to page". Above the list the count stays (with the size,
  // which still splits a list longer than the smallest page, and the list's
  // action); below it nothing repeats, since every list that pages alone
  // states its own count above it (journal, notes, highlights). Below it the
  // size stays while a smaller page would split the list: it is the size's
  // only place on a phone, and on a list that pages alone, so a size chosen
  // there can always be changed back
  const onePage = totalPages === 1;
  const splits = sizes.length > 1 && total > Math.min(...sizes);
  if (onePage && !compact && !action && !splits) return null;

  return (
    <nav
      ref={nav}
      id={compact ? anchor : undefined}
      aria-label={compact ? "Pagination overview" : "Pagination"}
      // Above the list every list's row reads the same: the count, the pager
      // and Per page from the left, the list's action (Select) at the right
      // (SLN-1025). Below it the pager spreads across the row
      className={`my-4 flex scroll-mt-4 flex-wrap items-center gap-3 font-mono tabular-nums ${compact ? "justify-start max-sm:gap-2" : "justify-between"}`}
    >
      {/* Above the list on a phone "1–48 of 775": the words stay for screen readers */}
      {(compact || !onePage) && <p className="text-xs text-fg-secondary">
        <span className={wordsClass}>Showing </span>
        {total ? ((current - 1) * perPage + 1).toLocaleString("en-US") : 0}–
        {Math.min(current * perPage, total).toLocaleString("en-US")} of{" "}
        {total.toLocaleString("en-US")}
        <span className={wordsClass}> {pagerNoun(noun, total)}</span>
      </p>}
      {/* Tighter on a phone above the list, so a 17-page count, its arrows
          and Select share one row at 390 */}
      {!onePage && <div className={`flex flex-wrap items-center gap-2 ${compact ? "not-pointer-coarse:max-sm:gap-1" : ""}`}>
        {!compact && (
          <span className="hidden md:contents">
            {pageLink(
              1,
              "First",
              <ChevronsLeft size={14} strokeWidth={1.5} />,
              current === 1,
            )}
          </span>
        )}
        {pageLink(
          current - 1,
          "Previous",
          <ChevronLeft size={14} strokeWidth={1.5} />,
          current === 1,
          "prev",
        )}
        {!compact && (
          <div className="hidden items-center gap-1 md:flex">
            {getPageRange(current, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <span
                  key={`gap-${i}`}
                  className="px-1 text-fg-secondary"
                  aria-hidden
                >
                  …
                </span>
              ) : (
                <Link
                  key={p}
                  href={href(p)}
                  aria-label={`Page ${p}`}
                  data-pager-control={`page-${p}`}
                  onClick={() => remember(anchor, `page-${p}`)}
                  aria-current={p === current ? "page" : undefined}
                  className={`${control} ${p === current ? "border-accent-primary bg-selection-bg text-fg-primary" : ""}`}
                >
                  {p}
                </Link>
              ),
            )}
          </div>
        )}
        <button
          type="button"
          className={`${control} ${compact ? "" : "md:hidden"}`}
          aria-label={`Page ${current} of ${totalPages}, jump to page`}
          data-pager-control="jump-toggle"
          onClick={() => {
            setMobileJump(!mobileJump);
            requestAnimationFrame(() => jumpRef.current?.focus());
          }}
        >
          {current} / {totalPages}
        </button>
        {pageLink(
          current + 1,
          "Next",
          <ChevronRight size={14} strokeWidth={1.5} />,
          current === totalPages,
          "next",
        )}
        {!compact && (
          <span className="hidden md:contents">
            {pageLink(
              totalPages,
              "Last",
              <ChevronsRight size={14} strokeWidth={1.5} />,
              current === totalPages,
            )}
          </span>
        )}
      </div>}
      {sizes.length > 1 && (!onePage || splits) && (
        // Above the list on a phone the size is left to the controls below it
        <label
          className={`flex items-center gap-2 text-xs text-fg-secondary ${compact ? "max-sm:hidden" : ""}`}
          htmlFor={`${id}-size`}
        >
          Per page
          <select
            id={`${id}-size`}
            data-pager-control="size"
            value={perPage}
            onChange={(e) => changeSize(Number(e.target.value))}
            className={`${control} bg-bg-primary`}
          >
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
      {action && <div className="ml-auto flex items-center font-sans">{action}</div>}
      {!compact && !onePage && (
        <div className={mobileJump ? "w-full" : "hidden w-full md:block"}>
          {jumpForm}
        </div>
      )}
      {compact && mobileJump && <div className="w-full">{jumpForm}</div>}
    </nav>
  );
}

export function PaginatedSection({
  children,
  noun, hideSingleSummary = false,
  ...pagination
}: PaginationData & { children: React.ReactNode; noun: string; hideSingleSummary?: boolean }) {
  if (hideSingleSummary && pagination.total <= pagination.perPage) return <>{children}</>;
  return (
    <>
      <Pagination {...pagination} noun={noun} compact />
      {children}
      <Pagination {...pagination} noun={noun} />
    </>
  );
}
