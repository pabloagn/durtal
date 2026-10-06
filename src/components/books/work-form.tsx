"use client";

import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SeriesFields } from "@/components/books/series-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TitleInput } from "@/components/shared/title-input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { RatingInput } from "@/components/shared/rating";
import { findOrCreateAuthor } from "@/lib/actions/authors";
import { LANGUAGES } from "@/lib/constants/languages";
import { normalizeSearchText } from "@/lib/utils/search-text";
import { seriesPositionSchema } from "@/lib/validations/series";
import { useAuthorSearch } from "@/hooks/use-author-search";
import {
  BookLinksFields,
  bookLinkValues,
  parseBookLinkValues,
  type BookLinkValues,
} from "@/components/books/book-links-fields";
import { isComposing } from "@/lib/shortcuts/shortcuts";

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({
  value: l.value,
  label: l.label,
}));

const CATALOGUE_STATUS_OPTIONS = [
  { value: "tracked", label: "Tracked" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "wanted", label: "Wanted" },
  { value: "on_order", label: "On Order" },
  { value: "accessioned", label: "Accessioned" },
  { value: "deaccessioned", label: "Deaccessioned" },
];

const ACQUISITION_PRIORITY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const AUTHOR_ROLE_OPTIONS = [
  { value: "author", label: "Author" },
  { value: "co_author", label: "Co-author" },
];

export interface WorkAuthorRow {
  id: string;
  name: string;
  role: string;
}

/** The work dialogs' fields, as the inputs hold them (text for numbers) */
export interface WorkFormValues {
  title: string;
  originalLanguage: string;
  originalYear: string;
  workTypeId: string;
  isAnthology: boolean;
  links: BookLinkValues;
  catalogueStatus: string;
  acquisitionPriority: string;
  rating: string;
  description: string;
  notes: string;
  recommenderIds: string[];
  seriesName: string;
  seriesId: string;
  seriesPosition: string;
  authors: WorkAuthorRow[];
}

export const EMPTY_WORK_FORM: WorkFormValues = {
  title: "",
  originalLanguage: "en",
  originalYear: "",
  workTypeId: "",
  isAnthology: false,
  links: bookLinkValues({}),
  catalogueStatus: "tracked",
  acquisitionPriority: "none",
  rating: "",
  description: "",
  notes: "",
  recommenderIds: [],
  seriesName: "",
  seriesId: "",
  seriesPosition: "",
  authors: [],
};

/** A stored work as the form's values */
export function workFormValues(
  work: {
    title: string;
    originalLanguage: string;
    originalYear: number | null;
    workTypeId: string | null;
    isAnthology: boolean;
    goodreadsUrl?: string | null;
    storygraphUrl?: string | null;
    catalogueStatus: string;
    acquisitionPriority: string;
    rating: number | null;
    description: string | null;
    notes: string | null;
    seriesName: string | null;
    seriesId: string | null;
    seriesPosition: string | null;
  },
  recommenderIds: string[],
  authors: WorkAuthorRow[],
): WorkFormValues {
  return {
    title: work.title,
    originalLanguage: work.originalLanguage,
    originalYear: work.originalYear != null ? String(work.originalYear) : "",
    workTypeId: work.workTypeId ?? "",
    isAnthology: work.isAnthology,
    links: bookLinkValues(work),
    catalogueStatus: work.catalogueStatus,
    acquisitionPriority: work.acquisitionPriority,
    rating: work.rating != null ? String(work.rating) : "",
    description: work.description ?? "",
    notes: work.notes ?? "",
    recommenderIds,
    seriesName: work.seriesName ?? "",
    seriesId: work.seriesId ?? "",
    seriesPosition: work.seriesPosition ?? "",
    authors,
  };
}

/** The form's values as updateWork takes them, or the first thing to correct */
export function workPayload(v: WorkFormValues) {
  if (v.seriesId === "__new" && !v.seriesName.trim())
    return { ok: false as const, error: "Enter a series name" };
  const checkedPosition = seriesPositionSchema.safeParse(v.seriesPosition);
  if (!checkedPosition.success)
    return { ok: false as const, error: checkedPosition.error.issues[0].message };
  if (!v.title.trim()) return { ok: false as const, error: "Title is required" };
  if (v.authors.length === 0)
    return { ok: false as const, error: "At least one author is required" };
  const parsedLinks = parseBookLinkValues(v.links);
  if (!parsedLinks.ok) return { ok: false as const, error: parsedLinks.error };
  return {
    ok: true as const,
    input: {
      title: v.title.trim(),
      originalLanguage: v.originalLanguage,
      originalYear: v.originalYear ? parseInt(v.originalYear, 10) : null,
      workTypeId: v.workTypeId || null,
      isAnthology: v.isAnthology,
      catalogueStatus: v.catalogueStatus as
        | "tracked"
        | "shortlisted"
        | "wanted"
        | "on_order"
        | "accessioned"
        | "deaccessioned",
      acquisitionPriority: v.acquisitionPriority as
        | "none"
        | "low"
        | "medium"
        | "high"
        | "urgent",
      rating: v.rating ? Number(v.rating) : null,
      description: v.description.trim() || null,
      notes: v.notes.trim() || null,
      recommenderIds: v.recommenderIds,
      seriesId: v.seriesId === "__new" ? null : v.seriesId || null,
      seriesName: v.seriesName.trim() || null,
      seriesPosition: v.seriesPosition.trim() || null,
      goodreadsUrl: parsedLinks.links.goodreadsUrl,
      storygraphUrl: parsedLinks.links.storygraphUrl,
      authorIds: v.authors.map((a) => ({
        authorId: a.id,
        role: a.role as "author" | "co_author",
      })),
    },
  };
}

/**
 * The work dialogs' body and footer: core details, links, status,
 * description and notes, series and authors. `idPrefix` names the fields'
 * ids, so two dialogs can share a page.
 */
export function WorkForm({
  idPrefix,
  values,
  onChange,
  workTypes,
  series,
  recommenders,
  seriesKey,
  pending,
  onCancel,
  onSubmit,
  notice,
}: {
  idPrefix: string;
  values: WorkFormValues;
  /** A state setter: updates compose */
  onChange: Dispatch<SetStateAction<WorkFormValues>>;
  workTypes: { id: string; name: string }[];
  series: { id: string; title: string }[];
  recommenders: { id: string; name: string }[];
  /** Resets the series fields' own state when it changes */
  seriesKey: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  /** A line at the footer's start, such as the lists' loading state */
  notice?: ReactNode;
}) {
  const set = <K extends keyof WorkFormValues>(key: K, value: WorkFormValues[K]) =>
    onChange((current) => ({ ...current, [key]: value }));
  const setAuthors = (update: (authors: WorkAuthorRow[]) => WorkAuthorRow[]) =>
    onChange((current) => ({ ...current, authors: update(current.authors) }));
  const id = (name: string) => `${idPrefix}-${name}`;

  const [authorSearch, setAuthorSearch] = useState("");
  const [showAuthorAdd, setShowAuthorAdd] = useState(false);
  const [isAddingAuthor, setIsAddingAuthor] = useState(false);
  // Author search runs on the server, so every author can be found
  const { results: filteredAuthors, isSearching: isSearchingAuthors } =
    useAuthorSearch(authorSearch);
  // "Create" only when the typed name is not already an author
  const authorExists = filteredAuthors.some(
    (a) => normalizeSearchText(a.name) === normalizeSearchText(authorSearch),
  );
  const authorAlreadyAdded = (authorId: string) =>
    values.authors.some((a) => a.id === authorId);

  function removeAuthor(authorId: string) {
    if (values.authors.length <= 1) {
      toast.error("At least one author is required");
      return;
    }
    setAuthors((prev) => prev.filter((a) => a.id !== authorId));
  }

  function updateAuthorRole(authorId: string, role: string) {
    setAuthors((prev) => prev.map((a) => (a.id === authorId ? { ...a, role } : a)));
  }

  function addExistingAuthor(author: { id: string; name: string }) {
    if (authorAlreadyAdded(author.id)) {
      toast.error(`${author.name} is already listed`);
      return;
    }
    setAuthors((prev) => [...prev, { id: author.id, name: author.name, role: "author" }]);
    setAuthorSearch("");
    setShowAuthorAdd(false);
  }

  async function addNewAuthor(name: string) {
    if (!name.trim()) return;
    setIsAddingAuthor(true);
    try {
      const created = await findOrCreateAuthor(name.trim());
      if (authorAlreadyAdded(created.id)) {
        toast.error(`${created.name} is already listed`);
      } else {
        setAuthors((prev) => [
          ...prev,
          { id: created.id, name: created.name, role: "author" },
        ]);
      }
    } catch {
      toast.error("Failed to add author");
    } finally {
      setIsAddingAuthor(false);
      setAuthorSearch("");
      setShowAuthorAdd(false);
    }
  }

  const workTypeOptions = [
    { value: "", label: "None" },
    ...workTypes.map((wt) => ({ value: wt.id, label: wt.name })),
  ];
  const seriesOptions = [
    { value: "", label: "None" },
    ...series.map((s) => ({ value: s.id, label: s.title })),
  ];

  return (
    <>
      <div className="max-h-[75vh] overflow-y-auto pr-1">
        <div className="space-y-6">
          {/* Core Details */}
          <section>
            <h3 className="type-group-title mb-3">
              Core Details
            </h3>
            <div className="space-y-3">
              <TitleInput
                id={id("title")}
                label="Title"
                value={values.title}
                onValueChange={(title) => set("title", title)}
                language={values.originalLanguage}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Select
                  id={id("language")}
                  label="Original Language"
                  options={LANGUAGE_OPTIONS}
                  value={values.originalLanguage}
                  onChange={(e) => set("originalLanguage", e.target.value)}
                />
                <Input
                  id={id("year")}
                  label="Original Year"
                  type="number"
                  min={-3000}
                  max={2100}
                  value={values.originalYear}
                  onChange={(e) => set("originalYear", e.target.value)}
                  placeholder="e.g. 1984"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  id={id("work-type")}
                  label="Work Type"
                  options={workTypeOptions}
                  value={values.workTypeId}
                  onChange={(e) => set("workTypeId", e.target.value)}
                />
                <div className="flex items-end pb-0.5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
                    <input
                      type="checkbox"
                      checked={values.isAnthology}
                      onChange={(e) => set("isAnthology", e.target.checked)}
                      className="h-4 w-4 rounded-sm border-glass-border accent-accent-rose"
                    />
                    Anthology
                  </label>
                </div>
              </div>
            </div>
          </section>

          <BookLinksFields
            idPrefix={idPrefix}
            values={values.links}
            onChange={(links) => set("links", links)}
          />

          {/* Status */}
          <section>
            <h3 className="type-group-title mb-3">
              Status
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Select
                id={id("catalogue-status")}
                label="Catalogue Status"
                options={CATALOGUE_STATUS_OPTIONS}
                value={values.catalogueStatus}
                onChange={(e) => set("catalogueStatus", e.target.value)}
              />
              <Select
                id={id("acq-priority")}
                label="Acquisition Priority"
                options={ACQUISITION_PRIORITY_OPTIONS}
                value={values.acquisitionPriority}
                onChange={(e) => set("acquisitionPriority", e.target.value)}
              />
            </div>
            {/* Its own row: on touch the five stars are 44px each */}
            <div className="mt-3 space-y-1.5">
              <span id={id("rating")} className="type-label block">
                Rating
              </span>
              <div className="text-sm">
                <RatingInput
                  label="Rating"
                  value={values.rating ? Number(values.rating) : null}
                  onChange={(next) => set("rating", next === null ? "" : String(next))}
                />
              </div>
            </div>
          </section>

          {/* Description & Notes */}
          <section>
            <h3 className="type-group-title mb-3">
              Description &amp; Notes
            </h3>
            <div className="space-y-3">
              <Textarea
                id={id("description")}
                label="Description"
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
                rows={4}
                placeholder="Brief description of the work"
              />
              <Textarea
                id={id("notes")}
                label="Notes"
                value={values.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
                placeholder="Personal notes"
              />
              <div>
                <label htmlFor={id("recommender")} className="type-label mb-1.5 block">
                  Recommended by
                </label>
                {values.recommenderIds.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {values.recommenderIds.map((rid) => {
                      const r = recommenders.find((x) => x.id === rid);
                      return r ? (
                        <span
                          key={rid}
                          className="inline-flex items-center gap-1 rounded-sm border border-glass-border bg-bg-secondary px-2 py-0.5 text-xs text-fg-secondary"
                        >
                          {r.name}
                          <button
                            aria-label={`Remove ${r.name}`}
                            data-tooltip={`Remove ${r.name}`}
                            type="button"
                            onClick={() =>
                              set(
                                "recommenderIds",
                                values.recommenderIds.filter((x) => x !== rid),
                              )
                            }
                            className="text-fg-muted transition-colors hover:text-fg-primary"
                          >
                            <X className="h-3 w-3" strokeWidth={1.5} />
                          </button>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
                <select
                  id={id("recommender")}
                  value=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val && !values.recommenderIds.includes(val)) {
                      set("recommenderIds", [...values.recommenderIds, val]);
                    }
                  }}
                  className="h-9 w-full appearance-none rounded-sm border border-glass-border bg-bg-secondary px-3 text-sm text-fg-primary transition-colors focus:border-accent-rose focus:outline-none"
                >
                  <option value="">Add recommender...</option>
                  {recommenders
                    .filter((r) => !values.recommenderIds.includes(r.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </section>

          <SeriesFields
            key={seriesKey}
            options={seriesOptions}
            seriesId={values.seriesId}
            seriesName={values.seriesName}
            position={values.seriesPosition}
            onId={(seriesId) => set("seriesId", seriesId)}
            onName={(seriesName) => set("seriesName", seriesName)}
            onPosition={(seriesPosition) => set("seriesPosition", seriesPosition)}
          />

          {/* Authors */}
          <section>
            <h3 className="type-group-title mb-3">
              Authors
            </h3>
            <div className="space-y-2">
              {values.authors.map((author) => (
                <div
                  key={author.id}
                  className="flex items-center gap-2 rounded-sm border border-glass-border bg-bg-primary px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                    {author.name}
                  </span>
                  <select
                    aria-label={`Role of ${author.name}`}
                    value={author.role}
                    onChange={(e) => updateAuthorRole(author.id, e.target.value)}
                    className="h-7 appearance-none rounded-sm border border-glass-border bg-bg-secondary px-2 text-xs text-fg-secondary transition-colors focus:border-accent-rose focus:outline-none"
                  >
                    {AUTHOR_ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeAuthor(author.id)}
                    disabled={values.authors.length <= 1}
                    className="rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary disabled:pointer-events-none disabled:opacity-30"
                    aria-label="Remove author"
                    data-tooltip="Remove author"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              ))}

              {showAuthorAdd ? (
                <div className="rounded-sm border border-glass-border bg-bg-primary p-3">
                  <input
                    autoFocus
                    type="text"
                    value={authorSearch}
                    onChange={(e) => setAuthorSearch(e.target.value)}
                    placeholder="Search author by name..."
                    className="mb-2 h-8 pointer-coarse:h-11 w-full rounded-sm border border-glass-border bg-bg-secondary px-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && !isComposing(e)) {
                        // The author search closes; the dialog stays
                        e.preventDefault();
                        setShowAuthorAdd(false);
                        setAuthorSearch("");
                      }
                    }}
                  />
                  <div className="max-h-40 overflow-y-auto">
                    {filteredAuthors.length > 0
                      ? filteredAuthors.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => addExistingAuthor(a)}
                            disabled={authorAlreadyAdded(a.id)}
                            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:opacity-40"
                          >
                            {a.name}
                          </button>
                        ))
                      : null}
                    {authorSearch.trim() && !isSearchingAuthors && !authorExists && (
                      <button
                        type="button"
                        onClick={() => addNewAuthor(authorSearch)}
                        disabled={isAddingAuthor}
                        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                      >
                        {isAddingAuthor ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                        ) : (
                          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        )}
                        Create &ldquo;{authorSearch.trim()}&rdquo;
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAuthorAdd(false);
                      setAuthorSearch("");
                    }}
                    className="mt-2 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAuthorAdd(true)}
                  className="flex items-center gap-1.5 rounded-sm border border-dashed border-glass-border px-3 py-2 text-sm text-fg-secondary transition-colors hover:border-bg-secondary hover:text-fg-primary"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Add author
                </button>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-5 flex items-center justify-end gap-2 border-t border-glass-border pt-4">
        {notice && <div className="mr-auto min-w-0">{notice}</div>}
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={pending || !values.title.trim()}
        >
          {pending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              Saving
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
    </>
  );
}
