"use client";

import { useRef, useState } from "react";
import { searchAuthorsLite } from "@/lib/actions/authors";
import { AuthorNameInput } from "@/components/shared/author-name-input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { languageOptions } from "@/lib/utils/language";
import type { PrepareEbookReview, ReviewQueueRow, ReviewPreparationIssue } from "@/lib/ebooks/review-queue/types";

export function NewBookFields({ row, disabled, onPrepare, issues = [] }: {
  row: ReviewQueueRow; disabled: boolean; onPrepare: (intent: PrepareEbookReview) => void;
  issues?: readonly ReviewPreparationIssue[];
}) {
  const [name, setName] = useState(row.authors.length === 1 ? row.authors[0] : "");
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [authors, setAuthors] = useState<Awaited<ReturnType<typeof searchAuthorsLite>>>([]);
  const [language, setLanguage] = useState(row.language ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  async function search() {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try { const found = await searchAuthorsLite(name);
      if (current === generation.current) setAuthors(found);
    } catch { if (current === generation.current) setError("The author search could not be loaded."); }
    finally { if (current === generation.current) setLoading(false); }
  }
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault();
    if (name.trim() && language) onPrepare({ action: "accession", ebookId: row.id,
      authors: [authorId ? { id: authorId } : { name: name.trim() }], language, isbn13: null }); }}>
    <p className="text-sm text-fg-secondary">Choose the author identity and language for the new book. The preview shows exactly what will be created.</p>
    <div className="flex items-end gap-2"><div className="min-w-0 flex-1">
      <AuthorNameInput label="Author" value={name} maxLength={300} disabled={disabled || loading}
        error={issues.find((issue) => issue.field === "authors")?.message}
        onValueChange={(value) => { generation.current++; setName(value); setAuthorId(null); setAuthors([]); setLoading(false); }} />
    </div><Button type="button" disabled={disabled || loading || !name.trim()} onClick={() => void search()}>Find existing</Button></div>
    {authors.length > 0 && <fieldset disabled={disabled} className="space-y-1">
      <legend className="type-label">Author identity</legend>
      {authors.map((author) => <label key={author.id} className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-11">
        <input type="radio" name="author-identity" checked={authorId === author.id}
          onChange={() => { setAuthorId(author.id); setName(author.name); }} />{author.name} · already in Durtal
      </label>)}
      <label className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-11">
        <input type="radio" name="author-identity" checked={authorId === null} onChange={() => setAuthorId(null)} />Create a new author: {name}
      </label>
    </fieldset>}
    <Select label="Language" value={language} disabled={disabled} options={languageOptions(language)}
      error={issues.find((issue) => issue.field === "language")?.message}
      placeholder="Choose a language" onChange={(event) => setLanguage(event.target.value)} />
    <p className="text-xs text-fg-secondary">The new edition will have no ISBN. Link to an existing book when its ISBN is already in the catalogue.</p>
    {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
    <Button type="submit" variant="primary" disabled={disabled || !name.trim() || !language}>Preview new book</Button>
  </form>;
}
