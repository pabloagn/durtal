"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { updateWork } from "@/lib/actions/works";
import { findOrCreateAuthor } from "@/lib/actions/authors";
import { LANGUAGES } from "@/lib/constants/languages";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthorRow {
  id: string;
  name: string;
  role: string;
}

interface WorkEditDialogProps {
  work: {
    id: string;
    slug: string;
    title: string;
    originalLanguage: string;
    originalYear: number | null;
    description: string | null;
    seriesName: string | null;
    seriesPosition: string | null;
    seriesId: string | null;
    isAnthology: boolean;
    workTypeId: string | null;
    notes: string | null;
    rating: number | null;
    catalogueStatus: string;
    acquisitionPriority: string;
    recommenderIds: string[];
  };
  authors: AuthorRow[];
  availableAuthors: { id: string; name: string }[];
  availableSeries: { id: string; title: string }[];
  availableWorkTypes: { id: string; name: string }[];
  availableRecommenders: { id: string; name: string }[];
  /** When provided, the dialog is externally controlled and no trigger button is rendered */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ value: l.value, label: l.label }));

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

const RATING_OPTIONS = [
  { value: "", label: "No rating" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
];

const AUTHOR_ROLE_OPTIONS = [
  { value: "author", label: "Author" },
  { value: "co_author", label: "Co-author" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkEditDialog({
  work,
  authors: initialAuthors,
  availableAuthors,
  availableSeries,
  availableWorkTypes,
  availableRecommenders,
  open: controlledOpen,
  onOpenChange,
}: WorkEditDialogProps) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }
  const [isPending, startTransition] = useTransition();

  // Form state — Core Details
  const [title, setTitle] = useState(work.title);
  const [originalLanguage, setOriginalLanguage] = useState(work.originalLanguage);
  const [originalYear, setOriginalYear] = useState(
    work.originalYear != null ? String(work.originalYear) : "",
  );
  const [workTypeId, setWorkTypeId] = useState(work.workTypeId ?? "");
  const [isAnthology, setIsAnthology] = useState(work.isAnthology);

  // Form state — Status
  const [catalogueStatus, setCatalogueStatus] = useState(work.catalogueStatus);
  const [acquisitionPriority, setAcquisitionPriority] = useState(work.acquisitionPriority);
  const [rating, setRating] = useState(work.rating != null ? String(work.rating) : "");

  // Form state — Description & Notes
  const [description, setDescription] = useState(work.description ?? "");
  const [notes, setNotes] = useState(work.notes ?? "");
  const [recommenderIds, setRecommenderIds] = useState<string[]>(work.recommenderIds);

  // Form state — Series
  const [seriesId, setSeriesId] = useState(work.seriesId ?? "");
  const [seriesPosition, setSeriesPosition] = useState(work.seriesPosition ?? "");

  // Form state — Authors
  const [authors, setAuthors] = useState<AuthorRow[]>(initialAuthors);
  const [authorSearch, setAuthorSearch] = useState("");
  const [showAuthorAdd, setShowAuthorAdd] = useState(false);
  const [isAddingAuthor, setIsAddingAuthor] = useState(false);

  // Filtered authors for combobox
  const filteredAuthors = authorSearch.trim()
    ? availableAuthors.filter((a) =>
        a.name.toLowerCase().includes(authorSearch.trim().toLowerCase()),
      )
    : availableAuthors.slice(0, 10);

  const authorAlreadyAdded = (id: string) => authors.some((a) => a.id === id);

  function openDialog() {
    // Reset all fields to current work values
    setTitle(work.title);
    setOriginalLanguage(work.originalLanguage);
    setOriginalYear(work.originalYear != null ? String(work.originalYear) : "");
    setWorkTypeId(work.workTypeId ?? "");
    setIsAnthology(work.isAnthology);
    setCatalogueStatus(work.catalogueStatus);
    setAcquisitionPriority(work.acquisitionPriority);
    setRating(work.rating != null ? String(work.rating) : "");
    setDescription(work.description ?? "");
    setNotes(work.notes ?? "");
    setRecommenderIds(work.recommenderIds);
    setSeriesId(work.seriesId ?? "");
    setSeriesPosition(work.seriesPosition ?? "");
    setAuthors(initialAuthors);
    setAuthorSearch("");
    setShowAuthorAdd(false);
    setOpen(true);
  }

  function closeDialog() {
    if (isPending) return;
    setOpen(false);
  }

  // When externally controlled, reset form state whenever the dialog opens
  useEffect(() => {
    if (isControlled && open) {
      setTitle(work.title);
      setOriginalLanguage(work.originalLanguage);
      setOriginalYear(work.originalYear != null ? String(work.originalYear) : "");
      setWorkTypeId(work.workTypeId ?? "");
      setIsAnthology(work.isAnthology);
      setCatalogueStatus(work.catalogueStatus);
      setAcquisitionPriority(work.acquisitionPriority);
      setRating(work.rating != null ? String(work.rating) : "");
      setDescription(work.description ?? "");
      setNotes(work.notes ?? "");
      setRecommenderIds(work.recommenderIds);
      setSeriesId(work.seriesId ?? "");
      setSeriesPosition(work.seriesPosition ?? "");
      setAuthors(initialAuthors);
      setAuthorSearch("");
      setShowAuthorAdd(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, open]);

  function removeAuthor(id: string) {
    if (authors.length <= 1) {
      toast.error("At least one author is required");
      return;
    }
    setAuthors((prev) => prev.filter((a) => a.id !== id));
  }

  function updateAuthorRole(id: string, role: string) {
    setAuthors((prev) => prev.map((a) => (a.id === id ? { ...a, role } : a)));
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

  function handleSubmit() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (authors.length === 0) {
      toast.error("At least one author is required");
      return;
    }

    startTransition(async () => {
      try {
        await updateWork(work.id, {
          title: title.trim(),
          originalLanguage,
          originalYear: originalYear ? parseInt(originalYear, 10) : null,
          workTypeId: workTypeId || null,
          isAnthology,
          catalogueStatus: catalogueStatus as
            | "tracked"
            | "shortlisted"
            | "wanted"
            | "on_order"
            | "accessioned"
            | "deaccessioned",
          acquisitionPriority: acquisitionPriority as
            | "none"
            | "low"
            | "medium"
            | "high"
            | "urgent",
          rating: rating ? parseInt(rating, 10) : null,
          description: description.trim() || null,
          notes: notes.trim() || null,
          recommenderIds,
          seriesId: seriesId || null,
          seriesPosition: seriesPosition.trim() || null,
          authorIds: authors.map((a) => ({
            authorId: a.id,
            role: a.role as "author" | "co_author",
          })),
        });
        toast.success("Work updated");
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update work");
      }
    });
  }

  const workTypeOptions = [
    { value: "", label: "None" },
    ...availableWorkTypes.map((wt) => ({ value: wt.id, label: wt.name })),
  ];

  const seriesOptions = [
    { value: "", label: "None" },
    ...availableSeries.map((s) => ({ value: s.id, label: s.title })),
  ];

  return (
    <>
      {!isControlled && (
        <Button variant="ghost" size="sm" onClick={openDialog} type="button">
          <Pencil className="h-4 w-4" strokeWidth={1.5} />
          Edit
        </Button>
      )}

      <Dialog
        open={open}
        onClose={closeDialog}
        title="Edit Work"
      >
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          <div className="space-y-6">
            {/* Section: Core Details */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                Core Details
              </h3>
              <div className="space-y-3">
                <Input
                  id="edit-title"
                  label="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    id="edit-language"
                    label="Original Language"
                    options={LANGUAGE_OPTIONS}
                    value={originalLanguage}
                    onChange={(e) => setOriginalLanguage(e.target.value)}
                  />
                  <Input
                    id="edit-year"
                    label="Original Year"
                    type="number"
                    min={-3000}
                    max={2100}
                    value={originalYear}
                    onChange={(e) => setOriginalYear(e.target.value)}
                    placeholder="e.g. 1984"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    id="edit-work-type"
                    label="Work Type"
                    options={workTypeOptions}
                    value={workTypeId}
                    onChange={(e) => setWorkTypeId(e.target.value)}
                  />
                  <div className="flex items-end pb-0.5">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
                      <input
                        type="checkbox"
                        checked={isAnthology}
                        onChange={(e) => setIsAnthology(e.target.checked)}
                        className="h-4 w-4 rounded-sm border-glass-border accent-accent-rose"
                      />
                      Anthology
                    </label>
                  </div>
                </div>
              </div>
            </section>

            {/* Section: Status */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">Status</h3>
              <div className="grid grid-cols-3 gap-3">
                <Select
                  id="edit-catalogue-status"
                  label="Catalogue Status"
                  options={CATALOGUE_STATUS_OPTIONS}
                  value={catalogueStatus}
                  onChange={(e) => setCatalogueStatus(e.target.value)}
                />
                <Select
                  id="edit-acq-priority"
                  label="Acquisition Priority"
                  options={ACQUISITION_PRIORITY_OPTIONS}
                  value={acquisitionPriority}
                  onChange={(e) => setAcquisitionPriority(e.target.value)}
                />
                <Select
                  id="edit-rating"
                  label="Rating"
                  options={RATING_OPTIONS}
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                />
              </div>
            </section>

            {/* Section: Description & Notes */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                Description &amp; Notes
              </h3>
              <div className="space-y-3">
                <Textarea
                  id="edit-description"
                  label="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Brief description of the work"
                />
                <Textarea
                  id="edit-notes"
                  label="Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Personal notes"
                />
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-secondary">
                    Recommended by
                  </label>
                  {recommenderIds.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {recommenderIds.map((id) => {
                        const r = availableRecommenders.find((x) => x.id === id);
                        return r ? (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 rounded-sm border border-glass-border bg-bg-secondary px-2 py-0.5 text-xs text-fg-secondary"
                          >
                            {r.name}
                            <button
                              type="button"
                              onClick={() =>
                                setRecommenderIds((prev) =>
                                  prev.filter((x) => x !== id),
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
                    value=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val && !recommenderIds.includes(val)) {
                        setRecommenderIds((prev) => [...prev, val]);
                      }
                    }}
                    className="h-9 w-full appearance-none rounded-sm border border-glass-border bg-bg-secondary px-3 text-sm text-fg-primary transition-colors focus:border-accent-rose focus:outline-none"
                  >
                    <option value="">Add recommender...</option>
                    {availableRecommenders
                      .filter((r) => !recommenderIds.includes(r.id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Section: Series */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">Series</h3>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  id="edit-series"
                  label="Series"
                  options={seriesOptions}
                  value={seriesId}
                  onChange={(e) => setSeriesId(e.target.value)}
                />
                <Input
                  id="edit-series-position"
                  label="Series Position"
                  value={seriesPosition}
                  onChange={(e) => setSeriesPosition(e.target.value)}
                  placeholder="e.g. 1, 2.5"
                />
              </div>
            </section>

            {/* Section: Authors */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">Authors</h3>
              <div className="space-y-2">
                {authors.map((author) => (
                  <div
                    key={author.id}
                    className="flex items-center gap-2 rounded-sm border border-glass-border bg-bg-primary px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                      {author.name}
                    </span>
                    <select
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
                      disabled={authors.length <= 1}
                      className="rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary disabled:pointer-events-none disabled:opacity-30"
                      title="Remove author"
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
                      className="mb-2 h-8 w-full rounded-sm border border-glass-border bg-bg-secondary px-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setShowAuthorAdd(false);
                          setAuthorSearch("");
                        }
                      }}
                    />
                    <div className="max-h-40 overflow-y-auto">
                      {filteredAuthors.length > 0 ? (
                        filteredAuthors.map((a) => (
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
                      ) : null}
                      {authorSearch.trim() && (
                        <button
                          type="button"
                          onClick={() => addNewAuthor(authorSearch)}
                          disabled={isAddingAuthor}
                          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
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
                      className="mt-2 text-xs text-fg-muted transition-colors hover:text-fg-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAuthorAdd(true)}
                    className="flex items-center gap-1.5 rounded-sm border border-dashed border-glass-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-bg-secondary hover:text-fg-secondary"
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
          <Button variant="secondary" size="sm" onClick={closeDialog} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !title.trim()}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                Saving
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
