"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
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

export interface PaginationData {
  page: number;
  perPage: number;
  total: number;
}
interface Props extends PaginationData {
  noun: string;
  compact?: boolean;
  anchor?: string;
}
const control =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-sm border border-glass-border px-2 text-xs text-fg-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rose disabled:pointer-events-none disabled:opacity-35";

export function Pagination({
  page,
  perPage,
  total,
  noun,
  compact = false,
  anchor = "list-start",
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

  useEffect(() => {
    setJump(String(current));
  }, [current]);
  useEffect(() => {
    if (compact && window.location.hash === `#${anchor}`) {
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    }
  }, [compact, anchor, current, perPage]);
  useEffect(() => {
    if (!compact) return;
    const key = `durtal-per-page:${pathname}`;
    const search = new URLSearchParams(query);
    try {
      if (search.has("perPage")) {
        localStorage.setItem(key, String(perPage));
      } else {
        const saved = Number(localStorage.getItem(key));
        if (PAGE_SIZES.some((n) => n === saved) && saved !== perPage) {
          router.replace(pageHref(pathname, search, 1, saved), {
            scroll: false,
          });
        }
      }
    } catch {
      /* Pagination still works when storage is unavailable. */
    }
  }, [compact, pathname, query, perPage, router]);

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
    try {
      localStorage.setItem(`durtal-per-page:${pathname}`, String(size));
    } catch {
      /* optional preference */
    }
    router.push(href(1, size));
  }
  function submitJump(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(jump);
    if (!Number.isFinite(value) || !jump.trim()) return;
    router.push(href(Math.max(1, Math.min(totalPages, Math.trunc(value)))));
    setMobileJump(false);
  }
  function pageLink(
    p: number,
    label: string,
    icon: React.ReactNode,
    disabled: boolean,
    rel?: "prev" | "next",
  ) {
    return disabled ? (
      <button type="button" className={control} disabled aria-label={label}>
        {icon}
        <span>{label}</span>
      </button>
    ) : (
      <Link className={control} href={href(p)} rel={rel} aria-label={label}>
        {icon}
        <span>{label}</span>
      </Link>
    );
  }
  const jumpForm = (
    <form onSubmit={submitJump} className="flex items-center gap-2">
      <label htmlFor={`${id}-jump`} className="text-xs text-fg-muted">
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
      />
      <button type="submit" className={control}>
        Go
      </button>
    </form>
  );

  return (
    <nav
      id={compact ? anchor : undefined}
      aria-label={compact ? "Pagination overview" : "Pagination"}
      className="my-4 flex scroll-mt-4 flex-wrap items-center justify-between gap-3 font-mono tabular-nums"
    >
      <p className="text-xs text-fg-muted">
        Showing{" "}
        {total ? ((current - 1) * perPage + 1).toLocaleString("en-US") : 0}–
        {Math.min(current * perPage, total).toLocaleString("en-US")} of{" "}
        {total.toLocaleString("en-US")} {noun}
      </p>
      <div className="flex flex-wrap items-center gap-2">
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
                  className="px-1 text-fg-muted"
                  aria-hidden
                >
                  …
                </span>
              ) : (
                <Link
                  key={p}
                  href={href(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === current ? "page" : undefined}
                  className={`${control} ${p === current ? "border-accent-rose bg-accent-plum text-fg-primary" : ""}`}
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
      </div>
      <label
        className="flex items-center gap-2 text-xs text-fg-muted"
        htmlFor={`${id}-size`}
      >
        Per page
        <select
          id={`${id}-size`}
          value={perPage}
          onChange={(e) => changeSize(Number(e.target.value))}
          className={`${control} bg-bg-primary`}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      {!compact && (
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
  noun,
  ...pagination
}: PaginationData & { children: React.ReactNode; noun: string }) {
  return (
    <>
      <Pagination {...pagination} noun={noun} compact />
      {children}
      <Pagination {...pagination} noun={noun} />
    </>
  );
}
