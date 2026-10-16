"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  findNamedDuplicates,
  type NamedKind,
} from "@/lib/actions/named-duplicates";

/** Advisory, never disabling Save. Stale lookups cannot describe a new name. */
export function NameDuplicateNotice({
  kind,
  name,
  enabled = true,
}: {
  kind: NamedKind;
  name: string;
  enabled?: boolean;
}) {
  const query = name.trim();
  const [result, setResult] = useState<{
    query: string;
    rows: Awaited<ReturnType<typeof findNamedDuplicates>>;
    failed?: boolean;
  }>({ query: "", rows: [] });
  useEffect(() => {
    if (!enabled || !query) return;
    let live = true;
    const timer = setTimeout(() => {
      findNamedDuplicates({ kind, name: query }).then(
        (rows) => {
          if (live) setResult({ query, rows });
        },
        () => {
          if (live) setResult({ query, rows: [], failed: true });
        },
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, query, enabled]);
  if (!enabled || !query || result.query !== query) return null;
  if (result.failed)
    return (
      <p role="status" className="text-xs text-fg-secondary">
        Existing names could not be checked. You can still save.
      </p>
    );
  if (!result.rows.length) return null;
  return (
    <div role="status" className="space-y-1 text-xs text-fg-secondary">
      <p>
        {kind === "organization" ? "An" : "A"} {kind} with this{" "}
        {kind === "film" ||
        kind === "painting" ||
        kind === "perfume" ||
        kind === "series"
          ? "title"
          : "name"}{" "}
        already exists. You can still add another.
      </p>
      <ul className="space-y-1">
        {result.rows.map((row) => (
          <li key={row.id}>
            <Link
              href={row.href}
              className="text-command touch-hit inline-flex items-center break-words"
            >
              Open {row.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
