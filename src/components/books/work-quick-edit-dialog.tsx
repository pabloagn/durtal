"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { updateWork } from "@/lib/actions/works";
import { getWork } from "@/lib/actions/works";
import { getAuthors, findOrCreateAuthor } from "@/lib/actions/authors";
import { getSeries } from "@/lib/actions/series";
import { getWorkTypes } from "@/lib/actions/taxonomy";
import { getRecommenders } from "@/lib/actions/recommenders";
import { LANGUAGES } from "@/lib/constants/languages";

interface AuthorRow {
  id: string;
  name: string;
  role: string;
}

interface WorkQuickEditDialogProps {
  open: boolean;
  onClose: () => void;
  workId: string;
}

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

export function WorkQuickEditDialog({
  open,
  onClose,
  workId,
}: WorkQuickEditDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Reference data
  const [allAuthors, setAllAuthors] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [allSeries, setAllSeries] = useState<{ id: string; title: string }[]>(
    [],
  );
  const [allWorkTypes, setAllWorkTypes] = useState<
    { id: string; name: string }[]
  >([]);
  const [allRecommenders, setAllRecommenders] = useState<
    { id: string; name: string }[]
  >([]);

  // Form state
  const [title, setTitle] = useState("");
  const [originalLanguage, setOriginalLanguage] = useState("en");
  const [originalYear, setOriginalYear] = useState("");
  const [workTypeId, setWorkTypeId] = useState("");
  const [isAnthology, setIsAnthology] = useState(false);
  const [catalogueStatus, setCatalogueStatus] = useState("tracked");
  const [acquisitionPriority, setAcquisitionPriority] = useState("none");
  const [rating, setRating] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [recommenderIds, setRecommenderIds] = useState<string[]>([]);
  const [seriesId, setSeriesId] = useState("");
  const [seriesPosition, setSeriesPosition] = useState("");
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [authorSearch, setAuthorSearch] = useState("");
  const [showAuthorAdd, setShowAuthorAdd] = useState(false);
  const [isAddingAuthor, setIsAddingAuthor] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [work, authorsData, seriesData, workTypesData, recommendersData] =
        await Promise.all([
          getWork(workId),
          getAuthors({ limit: 1000 }),
          getSeries(),
          getWorkTypes(),
          getRecommenders(),
        ]);

      if (!work) {
        toast.error("Work not found");
        onClose();
        return;
      }

      setAllAuthors(authorsData.map((a) => ({ id: a.id, name: a.name })));
      setAllSeries(seriesData.map((s) => ({ id: s.id, title: s.title })));
      setAllWorkTypes(workTypesData.map((wt) => ({ id: wt.id, name: wt.name })));
      setAllRecommenders(
        recommendersData.map((r) => ({ id: r.id, name: r.name })),
      );

      // Populate form
      setTitle(work.title);
      setOriginalLanguage(work.originalLanguage);
      setOriginalYear(
        work.originalYear != null ? String(work.originalYear) : "",
      );
      setWorkTypeId(work.workTypeId ?? "");
      setIsAnthology(work.isAnthology);
      setCatalogueStatus(work.catalogueStatus);
      setAcquisitionPriority(work.acquisitionPriority);
      setRating(work.rating != null ? String(work.rating) : "");
      setDescription(work.description ?? "");
      setNotes(work.notes ?? "");
      setRecommenderIds(
        (work as any).workRecommenders?.map((wr: any) => wr.recommender.id) ?? [],
      );
      setSeriesId(work.seriesId ?? "");
      setSeriesPosition(work.seriesPosition ?? "");
      setAuthors(
        work.workAuthors.map((wa) => ({
          id: wa.author.id,
          name: wa.author.name,
          role: wa.role,
        })),
      );

      setLoaded(true);
    } catch {
      toast.error("Failed to load work data");
    } finally {
      setLoading(false);
    }
  }, [workId, onClose]);

  useEffect(() => {
    if (open && !loaded) {
      fetchData();
    }
  }, [open, loaded, fetchData]);

  useEffect(() => {
    if (!open) {
      setLoaded(false);
    }
  }, [open]);

  const filteredAuthors = authorSearch.trim()
    ? allAuthors.filter((a) =>
        a.name.toLowerCase().includes(authorSearch.trim().toLowerCase()),
      )
    : allAuthors.slice(0, 10);

  const authorAlreadyAdded = (id: string) => authors.some((a) => a.id === id);

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
    setAuthors((prev) => [
      ...prev,
      { id: author.id, name: author.name, role: "author" },
    ]);
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
        await updateWork(workId, {
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
        onClose();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update work",
        );
      }
    });
  }

  const workTypeOptions = [
    { value: "", label: "None" },
    ...allWorkTypes.map((wt) => ({ value: wt.id, label: wt.name })),
  ];

  const seriesOptions = [
    { value: "", label: "None" },
    ...allSeries.map((s) => ({ value: s.id, label: s.title })),
  ];

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!isPending) onClose();
      }}
      title="Edit Work"
    >
      {loading || !loaded ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <div className="space-y-6">
              {/* Core Details */}
              <section>
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                  Core Details
                </h3>
                <div className="space-y-3">
                  <Input
                    label="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Select
                      label="Original Language"
                      options={LANGUAGE_OPTIONS}
                      value={originalLanguage}
                      onChange={(e) => setOriginalLanguage(e.target.value)}
                    />
                    <Input
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

              {/* Status */}
              <section>
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                  Status
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <Select
                    label="Catalogue Status"
                    options={CATALOGUE_STATUS_OPTIONS}
                    value={catalogueStatus}
                    onChange={(e) => setCatalogueStatus(e.target.value)}
                  />
                  <Select
                    label="Acquisition Priority"
                    options={ACQUISITION_PRIORITY_OPTIONS}
                    value={acquisitionPriority}
                    onChange={(e) => setAcquisitionPriority(e.target.value)}
                  />
                  <Select
                    label="Rating"
                    options={RATING_OPTIONS}
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                  />
                </div>
              </section>

              {/* Description & Notes */}
              <section>
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                  Description &amp; Notes
                </h3>
                <div className="space-y-3">
                  <Textarea
                    label="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    placeholder="Brief description of the work"
                  />
                  <Textarea
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
                          const r = allRecommenders.find((x) => x.id === id);
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
                      {allRecommenders
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

              {/* Series */}
              <section>
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                  Series
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Series"
                    options={seriesOptions}
                    value={seriesId}
                    onChange={(e) => setSeriesId(e.target.value)}
                  />
                  <Input
                    label="Series Position"
                    value={seriesPosition}
                    onChange={(e) => setSeriesPosition(e.target.value)}
                    placeholder="e.g. 1, 2.5"
                  />
                </div>
              </section>

              {/* Authors */}
              <section>
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                  Authors
                </h3>
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
                        onChange={(e) =>
                          updateAuthorRole(author.id, e.target.value)
                        }
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
                        {authorSearch.trim() && (
                          <button
                            type="button"
                            onClick={() => addNewAuthor(authorSearch)}
                            disabled={isAddingAuthor}
                            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
                          >
                            {isAddingAuthor ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                strokeWidth={1.5}
                              />
                            ) : (
                              <Plus
                                className="h-3.5 w-3.5"
                                strokeWidth={1.5}
                              />
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
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isPending}
            >
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
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    strokeWidth={1.5}
                  />
                  Saving
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
