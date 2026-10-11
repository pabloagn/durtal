"use client";

import { Select } from "@/components/ui/select";
import { languageOptions } from "@/lib/utils/language";
import type { EditionChoice, ReviewQueueRow, ReviewWorkOptions, ReviewPreparationIssue } from "@/lib/ebooks/review-queue/types";

export function EditionChoiceFields({ options, row, choice, onChange, disabled, issues = [] }: {
  options: ReviewWorkOptions; row: ReviewQueueRow; choice: EditionChoice;
  onChange: (value: EditionChoice) => void; disabled: boolean;
  issues?: readonly ReviewPreparationIssue[];
}) {
  const selected = choice.kind === "new_edition" ? "new" : choice.kind === "fill_copy"
    ? `fill:${choice.instanceId}` : `add:${choice.editionId}`;
  return <fieldset disabled={disabled} className="space-y-4">
    <legend className="type-label mb-2">Edition and copy</legend>
    {issues.filter((issue) => ["edition", "copy", "metadata"].includes(issue.field)).map((issue, index) =>
      <p key={`${issue.code}:${index}`} className="text-xs text-accent-red-text">{issue.message}</p>)}
    <div className="max-h-64 space-y-1 overflow-auto rounded-sm border border-glass-border p-2">
      {options.editions.map((edition) => <div key={edition.id} className="space-y-1 border-b border-glass-border/60 py-2 last:border-0">
        <p className="text-sm">{edition.placeholder ? "Edition not identified" : edition.title}</p>
        <p className="text-xs text-fg-secondary">{[edition.language, edition.isbn13, edition.publisher, edition.year].filter((value) => value !== null).join(" · ")}</p>
        {edition.copyCount > edition.copies.length && <p className="text-xs text-fg-muted">Showing {edition.copies.length} of {edition.copyCount} copies. Open the book to inspect the remaining copies.</p>}
        {edition.locked ? <p className="text-xs text-fg-muted">This edition is locked.</p> : <>
          {edition.copies.filter((copy) => copy.canFill).map((copy) => <label key={copy.id} className="flex min-h-8 items-center gap-2 text-xs pointer-coarse:min-h-11">
            <input type="radio" name="edition-choice" checked={selected === `fill:${copy.id}`}
              onChange={() => onChange({ kind: "fill_copy", editionId: edition.id, instanceId: copy.id })} />
            Fill this edition’s digital copy{copy.location ? ` · ${copy.location}` : ""}
          </label>)}
          <label className="flex min-h-8 items-center gap-2 text-xs pointer-coarse:min-h-11">
            <input type="radio" name="edition-choice" checked={selected === `add:${edition.id}`}
              onChange={() => onChange({ kind: "add_copy", editionId: edition.id })} />Add a copy of this edition
          </label>
        </>}
      </div>)}
      {options.editionCount > options.editions.length && <p className="text-xs text-fg-muted">Showing the first {options.editions.length} of {options.editionCount} editions.</p>}
      <label className="flex min-h-8 items-center gap-2 text-xs pointer-coarse:min-h-11">
        <input type="radio" name="edition-choice" checked={selected === "new"}
          onChange={() => onChange({ kind: "new_edition", ...(row.language ? { language: row.language } : {}) })} />New eBook edition
      </label>
    </div>
    {choice.kind === "new_edition" && <div className="grid gap-3 sm:grid-cols-2">
      <Select label="Language" value={choice.language ?? ""} placeholder="Choose a language"
        error={issues.find((issue) => issue.field === "language")?.message}
        options={languageOptions(choice.language)} onChange={(event) => onChange({ ...choice, language: event.target.value })} />
      <Select label="ISBN" value={choice.isbn13 ?? ""} options={[
        { value: "", label: "No ISBN" },
        ...row.isbns.map((isbn) => { const holder = options.isbnHolders.find((item) => item.isbn13 === isbn);
          return { value: isbn, label: holder ? `${isbn} · held by ${holder.title}` : isbn }; }),
      ].filter((option) => !option.value || !options.isbnHolders.some((holder) => holder.isbn13 === option.value))}
        error={issues.find((issue) => issue.field === "isbn13")?.message}
        onChange={(event) => onChange({ ...choice, isbn13: event.target.value || null })} />
    </div>}
  </fieldset>;
}

export function ReviewCopyFields({ options, locationId, onLocation, disabled, issues = [] }: {
  options: ReviewWorkOptions; locationId: string; onLocation: (value: string) => void; disabled: boolean;
  issues?: readonly ReviewPreparationIssue[];
}) {
  return <Select label="Digital location" value={locationId} disabled={disabled}
    error={issues.find((issue) => issue.field === "locationId")?.message}
    placeholder="Configured eBooks location" options={options.locations.map((location) => ({ value: location.id, label: location.name }))}
    onChange={(event) => onLocation(event.target.value)} />;
}
