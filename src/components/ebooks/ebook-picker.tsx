"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchReviewEbooksUi } from "@/lib/actions/ebook-review-ui";
import type { ReviewQueueRow } from "@/lib/ebooks/review-queue/types";

export function EbookPicker({ value, onChange, disabled }: {
  value: ReviewQueueRow | null; onChange: (row: ReviewQueueRow | null) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState(""); const [rows, setRows] = useState<ReviewQueueRow[]>([]);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  async function search() {
    const current = ++generation.current; setLoading(true); setError(null);
    const result = await searchReviewEbooksUi(query).catch(() => null);
    if (current !== generation.current) return;
    if (result?.ok) setRows(result.value);
    else setError(result && !result.ok ? result.error.message : "The eBook search could not be loaded.");
    setLoading(false);
  }
  if (value) return <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-glass-border p-3">
    <div className="min-w-0"><p className="text-sm">{value.title}</p><p className="text-xs text-fg-secondary">{value.authors.join(" & ")}</p></div>
    <Button type="button" size="sm" disabled={disabled} onClick={() => onChange(null)}>Change eBook</Button>
  </div>;
  return <div className="space-y-3">
    <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Input label="Find an unlinked eBook" value={query}
      maxLength={200} disabled={disabled || loading} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}
      onChange={(event) => { generation.current++; setLoading(false); setQuery(event.target.value); }} /></div>
      <Button type="button" disabled={disabled || loading} onClick={() => void search()}>Search</Button></div>
    <div className="max-h-56 overflow-auto" aria-label="Unlinked eBooks">
      {rows.map((row) => <button key={row.id} type="button" disabled={disabled || !row.stamp}
        className="block w-full rounded-sm px-3 py-2 text-left hover:bg-glass-highlight pointer-coarse:min-h-11" onClick={() => onChange(row)}>
        <span className="block text-sm">{row.title}</span><span className="text-xs text-fg-secondary">{row.authors.join(" & ")} · {row.files.map((file) => file.format.toUpperCase()).join(", ")}</span>
      </button>)}
    </div>{error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
  </div>;
}
