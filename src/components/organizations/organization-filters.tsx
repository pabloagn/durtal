"use client";

import { Input } from "@/components/ui/input";

import { useEffect, useRef } from "react";
import { useListSearchClear } from "@/lib/hooks/use-list-search-clear";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { firstPageHref } from "@/lib/utils/list-params";
import {
  DIRECTORY_ROLES,
  ORGANIZATION_ROLE_LABELS,
  type DirectoryRole,
} from "@/lib/catalogue/organizations";

const CHIP =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border px-3 text-sm transition-colors pointer-coarse:h-11";

/**
 * The directory's search (by name or other name) and its role filter: one
 * role at a time, each with the number of organizations that hold it among
 * those the search finds. Roles nobody holds are left out. Both live in the
 * URL, so a filtered directory can be linked.
 */
export function OrganizationFilters({
  counts,
}: {
  counts: { all: number; roles: Record<DirectoryRole, number> };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const current = searchParams.get("role");
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The field is uncontrolled so typing never fights the URL; a change from
  // outside (back, a cleared search) is copied in unless the field has focus
  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement !== input && input.value !== query) input.value = query;
  }, [query]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const hrefWith = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    return firstPageHref("/organizations", params);
  };
  useListSearchClear(inputRef, (navigate) => {
    clearTimeout(timer.current);
    if (navigate) router.push(hrefWith("q", null));
  });
  const roles = DIRECTORY_ROLES.filter((role) => counts.roles[role] > 0 || role === current);
  const chip = (label: string, count: number, role: DirectoryRole | null) => {
    const active = (current ?? null) === role;
    return (
      <Link
        key={role ?? "all"}
        href={hrefWith("role", role)}
        aria-current={active ? "page" : undefined}
        className={`${CHIP} ${
          active
            ? "border-accent-primary/40 bg-selection-bg text-fg-primary"
            : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
        }`}
      >
        {label}
        <span className="tabular-nums text-fg-secondary">{count.toLocaleString("en")}</span>
      </Link>
    );
  };

  return (
    <div className="mb-6 space-y-3">
      <div className="relative sm:max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
          strokeWidth={1.5}
          aria-hidden
        />
        <Input
          ref={inputRef}
          type="search"
          aria-label="Search organizations"
          // "/" focuses this field (keyboard shortcuts)
          data-shortcut-search=""
          aria-keyshortcuts="/"
          data-list-focus="search"
          placeholder="Search names and other names..."
          defaultValue={query}
          maxLength={200}
          onChange={(e) => {
            const value = e.target.value.trim();
            clearTimeout(timer.current);
            timer.current = setTimeout(() => router.push(hrefWith("q", value)), 300);
          }}
          className="pl-9"
        />
      </div>
      <nav aria-label="Roles" className="flex flex-wrap gap-2">
        {chip("All", counts.all, null)}
        {roles.map((role) => chip(ORGANIZATION_ROLE_LABELS[role].many, counts.roles[role], role))}
      </nav>
    </div>
  );
}
