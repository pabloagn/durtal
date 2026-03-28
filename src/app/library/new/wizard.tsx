"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  InstanceForm,
  EMPTY_INSTANCE,
  type InstanceDraft,
} from "@/components/books/instance-form";
import { CategorizationForm } from "@/components/books/categorization-form";
import { LANGUAGES } from "@/lib/constants/languages";
import { findDuplicateWork, createWork, getWork } from "@/lib/actions/works";
import { createEdition } from "@/lib/actions/editions";
import { createInstance } from "@/lib/actions/instances";
import { findOrCreateAuthor } from "@/lib/actions/authors";
import { getLocations } from "@/lib/actions/locations";
import { getSubjects, getGenres, getTags } from "@/lib/actions/taxonomy";
import { getCollections, addEditionToCollection } from "@/lib/actions/collections";

// ── Types ────────────────────────────────────────────────────────────────────

type Step =
  | "search"
  | "duplicate"
  | "details"
  | "edition"
  | "instance"
  | "categorize"
  | "confirm";

const STEPS: { key: Step; label: string }[] = [
  { key: "search", label: "Search" },
  { key: "details", label: "Details" },
  { key: "edition", label: "Edition" },
  { key: "instance", label: "Instance" },
  { key: "categorize", label: "Categorize" },
  { key: "confirm", label: "Confirm" },
];

interface SearchResult {
  source: string;
  sourceId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  publicationYear?: number;
  description?: string;
  isbn13?: string;
  isbn10?: string;
  pageCount?: number;
  categories?: string[];
  coverUrl?: string;
  language?: string;
}

interface DuplicateWork {
  id: string;
  title: string;
  workAuthors: { author: { name: string } }[];
  editions: { id: string; instances: { id: string }[] }[];
}

interface RefDataItem {
  id: string;
  name: string;
}

interface LocationItem {
  id: string;
  name: string;
  type: string;
  subLocations: { id: string; name: string }[];
}

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({
  value: l.value,
  label: l.label,
}));

// ── Wizard ───────────────────────────────────────────────────────────────────

export function AddBookWizard() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Duplicate detection
  const [duplicateWork, setDuplicateWork] = useState<DuplicateWork | null>(null);
  const [existingWorkId, setExistingWorkId] = useState<string | null>(null);

  // Work fields
  const [title, setTitle] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [originalYear, setOriginalYear] = useState("");
  const [originalLanguage, setOriginalLanguage] = useState("en");
  const [description, setDescription] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [seriesPosition, setSeriesPosition] = useState("");
  const [catalogueStatus, setCatalogueStatus] = useState("tracked");
  const [acquisitionPriority, setAcquisitionPriority] = useState("none");

  const isWishlistStatus = ["tracked", "shortlisted", "wanted"].includes(catalogueStatus);

  // Edition fields
  const [isbn13, setIsbn13] = useState("");
  const [publisher, setPublisher] = useState("");
  const [publicationYear, setPublicationYear] = useState("");
  const [language, setLanguage] = useState("en");
  const [pageCount, setPageCount] = useState("");
  const [binding, setBinding] = useState("");
  const [coverUrl, setCoverUrl] = useState("");

  // External source tracking
  const [metadataSource, setMetadataSource] = useState("");
  const [metadataSourceId, setMetadataSourceId] = useState("");

  // Instance drafts
  const [instanceDrafts, setInstanceDrafts] = useState<InstanceDraft[]>([
    { ...EMPTY_INSTANCE },
  ]);

  // Categorization
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [selectedGenreIds, setSelectedGenreIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);

  // Reference data (fetched once)
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [subjects, setSubjects] = useState<RefDataItem[]>([]);
  const [genres, setGenres] = useState<RefDataItem[]>([]);
  const [tags, setTags] = useState<RefDataItem[]>([]);
  const [collections, setCollections] = useState<RefDataItem[]>([]);
  const [refDataLoaded, setRefDataLoaded] = useState(false);

  // Fetch reference data when needed
  useEffect(() => {
    if (refDataLoaded) return;
    if (step !== "instance" && step !== "categorize" && step !== "confirm")
      return;
    setRefDataLoaded(true);
    Promise.all([
      getLocations(),
      getSubjects(),
      getGenres(),
      getTags(),
      getCollections(),
    ]).then(([locs, subs, gens, tgs, cols]) => {
      setLocations(
        locs.map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
          subLocations: l.subLocations.map((s) => ({
            id: s.id,
            name: s.name,
          })),
        })),
      );
      setSubjects(subs.map((s) => ({ id: s.id, name: s.name })));
      setGenres(gens.map((g) => ({ id: g.id, name: g.name })));
      setTags(tgs.map((t) => ({ id: t.id, name: t.name })));
      setCollections(
        cols.map((c) => ({
          id: c.id,
          name: c.name,
        })),
      );
    });
  }, [step, refDataLoaded]);

  // ── Search ───────────────────────────────────────────────────────────────

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const isIsbn = /^\d{10,13}$/.test(searchQuery.replace(/-/g, ""));
      const param = isIsbn
        ? `isbn=${searchQuery.replace(/-/g, "")}`
        : `q=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(`/api/search?${param}`);
      const data = await res.json();
      setSearchResults(data.results ?? []);
    } catch {
      toast.error("Search failed");
    } finally {
      setIsSearching(false);
    }
  }

  function selectResult(result: SearchResult) {
    setTitle(result.title);
    setAuthorName(result.authors[0] ?? "");
    setOriginalYear(String(result.publicationYear ?? ""));
    setOriginalLanguage(result.language ?? "en");
    setDescription(result.description ?? "");
    setIsbn13(result.isbn13 ?? "");
    setPublisher(result.publisher ?? "");
    setPublicationYear(String(result.publicationYear ?? ""));
    setLanguage(result.language ?? "en");
    setPageCount(String(result.pageCount ?? ""));
    setCoverUrl(result.coverUrl ?? "");
    setMetadataSource(result.source);
    setMetadataSourceId(result.sourceId);
    checkDuplicate(result.isbn13 ?? "", result.title, result.authors[0] ?? "");
  }

  async function checkDuplicate(isbn: string, t: string, author: string) {
    if (!t || !author) {
      setStep("details");
      return;
    }
    try {
      const dup = await findDuplicateWork({
        isbn13: isbn.replace(/-/g, "") || undefined,
        title: t,
        authorName: author,
      });
      if (dup) {
        setDuplicateWork(dup as DuplicateWork);
        setStep("duplicate");
      } else {
        setStep("details");
      }
    } catch {
      setStep("details");
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit() {
    startTransition(async () => {
      try {
        let workId = existingWorkId;
        let workSlug: string | undefined;

        // 1. Find or create author
        const author = await findOrCreateAuthor(authorName.trim());

        // 2. Create work (or use existing)
        if (!workId) {
          const work = await createWork({
            title: title.trim(),
            originalLanguage,
            originalYear: originalYear
              ? parseInt(originalYear, 10)
              : undefined,
            description: description || undefined,
            seriesName: seriesName || undefined,
            seriesPosition: seriesPosition || undefined,
            catalogueStatus: catalogueStatus as any,
            acquisitionPriority: acquisitionPriority as any,
            authorIds: [{ authorId: author.id, role: "author" }],
            subjectIds:
              selectedSubjectIds.length > 0
                ? selectedSubjectIds
                : undefined,
            metadataSource: metadataSource || undefined,
            metadataSourceId: metadataSourceId || undefined,
          } as any);
          workId = work.id;
          workSlug = work.slug ?? undefined;
        } else {
          // Existing work — fetch its slug for navigation
          const existingWork = await getWork(workId);
          workSlug = existingWork?.slug ?? undefined;
        }

        // 3. Create edition
        const cleanIsbn = isbn13.replace(/-/g, "");
        const edition = await createEdition({
          workId: workId!,
          title: title.trim(),
          isbn13: cleanIsbn.length === 13 ? cleanIsbn : undefined,
          publisher: publisher || undefined,
          publicationYear: publicationYear
            ? parseInt(publicationYear, 10)
            : undefined,
          language,
          pageCount: pageCount ? parseInt(pageCount, 10) : undefined,
          binding: binding || undefined,
          coverSourceUrl: coverUrl || undefined,
          metadataSource: metadataSource || undefined,
          genreIds:
            selectedGenreIds.length > 0 ? selectedGenreIds : undefined,
          tagIds:
            selectedTagIds.length > 0 ? selectedTagIds : undefined,
        });

        // 4. Create instances
        for (const draft of instanceDrafts) {
          if (!draft.locationId) continue;
          try {
            await createInstance({
              editionId: edition.id,
              locationId: draft.locationId,
              subLocationId: draft.subLocationId || undefined,
              format: draft.format || undefined,
              condition: draft.condition || undefined,
              hasDustJacket: draft.hasDustJacket,
              hasSlipcase: draft.hasSlipcase,
              conditionNotes: draft.conditionNotes || undefined,
              isSigned: draft.isSigned,
              signedBy: draft.signedBy || undefined,
              inscription: draft.inscription || undefined,
              isFirstPrinting: draft.isFirstPrinting,
              provenance: draft.provenance || undefined,
              acquisitionType: draft.acquisitionType || undefined,
              acquisitionDate: draft.acquisitionDate || undefined,
              acquisitionSource: draft.acquisitionSource || undefined,
              acquisitionPrice: draft.acquisitionPrice || undefined,
              acquisitionCurrency: draft.acquisitionCurrency || undefined,
              calibreId: draft.calibreId
                ? parseInt(draft.calibreId, 10)
                : undefined,
              calibreUrl: draft.calibreUrl || undefined,
              fileSizeBytes: draft.fileSizeBytes
                ? parseInt(draft.fileSizeBytes, 10)
                : undefined,
              notes: draft.notes || undefined,
            });
          } catch (err) {
            console.error("Failed to create instance:", err);
            toast.error("Failed to create one of the copies");
          }
        }

        // 5. Add to collections
        for (const colId of selectedCollectionIds) {
          try {
            await addEditionToCollection(colId, edition.id);
          } catch {
            // non-critical
          }
        }

        toast.success("Book added to catalogue");
        router.push(`/library/${workSlug ?? ""}`);
      } catch (err) {
        toast.error("Failed to add book");
        console.error(err);
      }
    });
  }

  // ── Instance helpers ─────────────────────────────────────────────────────

  function updateInstance(index: number, draft: InstanceDraft) {
    setInstanceDrafts((prev) =>
      prev.map((d, i) => (i === index ? draft : d)),
    );
  }

  function removeInstance(index: number) {
    setInstanceDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function addInstance() {
    setInstanceDrafts((prev) => [...prev, { ...EMPTY_INSTANCE }]);
  }

  // ── Step progress ────────────────────────────────────────────────────────

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  // "duplicate" step is not in STEPS — it's a transient step

  function StepProgress() {
    return (
      <div className="mb-6 flex items-center gap-1">
        {STEPS.map((s, i) => {
          const currentIdx = step === "duplicate" ? 0 : stepIndex;
          const isCompleted = i < currentIdx;
          const isCurrent = s.key === step || (step === "duplicate" && i === 0);
          return (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && (
                <div
                  className={`h-px w-4 ${isCompleted ? "bg-accent-sage" : "bg-bg-tertiary"}`}
                />
              )}
              <button
                type="button"
                disabled={!isCompleted}
                onClick={() => isCompleted && setStep(s.key)}
                className={`flex items-center gap-1 rounded-sm px-2 py-1 text-micro font-medium transition-colors ${
                  isCurrent
                    ? "bg-accent-plum text-accent-rose"
                    : isCompleted
                      ? "text-fg-secondary hover:text-fg-primary cursor-pointer"
                      : "text-fg-muted cursor-default"
                }`}
              >
                {isCompleted && (
                  <Check className="h-2.5 w-2.5" strokeWidth={2} />
                )}
                {s.label}
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      <StepProgress />

      {/* ── Step: Search ──────────────────────────────────────────────── */}
      {step === "search" && (
        <div className="space-y-6">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
              <input
                type="text"
                placeholder="Search by ISBN, title, or author..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="h-9 w-full rounded-sm border border-glass-border bg-bg-primary pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
                autoFocus
              />
            </div>
            <Button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map((result, i) => (
                <Card key={`${result.source}-${result.sourceId}-${i}`} hover>
                  <button
                    className="w-full text-left"
                    onClick={() => selectResult(result)}
                  >
                    <CardContent className="flex items-start gap-3 py-3">
                      {result.coverUrl && (
                        <img
                          src={result.coverUrl}
                          alt=""
                          className="h-16 w-11 shrink-0 rounded-sm object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-1 font-serif text-lg text-fg-primary">
                          {result.title}
                        </h3>
                        <p className="mt-0.5 line-clamp-1 text-xs text-fg-secondary">
                          {result.authors.join(", ")}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          {result.publicationYear && (
                            <span className="font-mono text-micro text-fg-muted">
                              {result.publicationYear}
                            </span>
                          )}
                          {result.publisher && (
                            <span className="text-micro text-fg-muted">
                              {result.publisher}
                            </span>
                          )}
                          <Badge variant="muted">
                            {result.source.replace("_", " ")}
                          </Badge>
                        </div>
                      </div>
                      <ArrowRight
                        className="mt-1 h-4 w-4 shrink-0 text-fg-muted"
                        strokeWidth={1.5}
                      />
                    </CardContent>
                  </button>
                </Card>
              ))}
            </div>
          )}

          <div className="border-t border-glass-border pt-4">
            <button
              onClick={() => setStep("details")}
              className="flex items-center gap-2 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Enter details manually
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Duplicate Detection ─────────────────────────────────── */}
      {step === "duplicate" && duplicateWork && (
        <div className="space-y-6">
          <div className="rounded-sm border border-accent-gold/30 bg-accent-gold/5 p-4">
            <h3 className="font-serif text-lg text-fg-primary">
              Possible duplicate found
            </h3>
            <p className="mt-1 text-xs text-fg-secondary">
              A work with a similar title and author already exists in your
              catalogue.
            </p>
          </div>

          <Card>
            <CardContent className="py-4">
              <h3 className="font-serif text-lg text-fg-primary">
                {duplicateWork.title}
              </h3>
              <p className="mt-1 text-xs text-fg-secondary">
                {duplicateWork.workAuthors
                  .map((wa) => wa.author.name)
                  .join(", ")}
              </p>
              <div className="mt-2 flex gap-2">
                <Badge variant="muted">
                  {duplicateWork.editions.length} edition
                  {duplicateWork.editions.length !== 1 ? "s" : ""}
                </Badge>
                <Badge variant="muted">
                  {duplicateWork.editions.reduce(
                    (sum, e) => sum + e.instances.length,
                    0,
                  )}{" "}
                  copies
                </Badge>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={() => {
                setExistingWorkId(duplicateWork.id);
                setStep("edition");
              }}
            >
              Add edition to this work
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setExistingWorkId(null);
                setStep("details");
              }}
            >
              Create as new work
            </Button>
          </div>
        </div>
      )}

      {/* ── Step: Work Details ────────────────────────────────────────── */}
      {step === "details" && (
        <div className="space-y-6">
          <div className="space-y-4">
            <Input
              label="Title"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Master and Margarita"
              required
            />
            <Input
              label="Author"
              id="author"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Mikhail Bulgakov"
              required
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Original year"
                id="originalYear"
                type="number"
                value={originalYear}
                onChange={(e) => setOriginalYear(e.target.value)}
                placeholder="1967"
              />
              <Select
                label="Original language"
                id="originalLanguage"
                value={originalLanguage}
                onChange={(e) => setOriginalLanguage(e.target.value)}
                options={LANGUAGE_OPTIONS}
              />
            </div>
            <Textarea
              label="Description"
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the work..."
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Series name"
                id="seriesName"
                value={seriesName}
                onChange={(e) => setSeriesName(e.target.value)}
                placeholder="The Dark Tower"
              />
              <Input
                label="Series position"
                id="seriesPosition"
                value={seriesPosition}
                onChange={(e) => setSeriesPosition(e.target.value)}
                placeholder="1"
              />
            </div>

            <div className="border-t border-bg-tertiary pt-4 mt-2">
              <p className="text-micro font-medium uppercase tracking-wider text-fg-muted mb-3">
                Catalogue status
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Status"
                  id="catalogueStatus"
                  value={catalogueStatus}
                  onChange={(e) => setCatalogueStatus(e.target.value)}
                  options={[
                    { value: "tracked", label: "Tracked" },
                    { value: "shortlisted", label: "Shortlisted" },
                    { value: "wanted", label: "Wanted" },
                    { value: "on_order", label: "On Order" },
                    { value: "accessioned", label: "Accessioned" },
                  ]}
                />
                <Select
                  label="Priority"
                  id="acquisitionPriority"
                  value={acquisitionPriority}
                  onChange={(e) => setAcquisitionPriority(e.target.value)}
                  options={[
                    { value: "none", label: "None" },
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                    { value: "urgent", label: "Urgent" },
                  ]}
                />
              </div>
              {isWishlistStatus && (
                <p className="mt-2 text-xs text-fg-muted">
                  You can add copies later from the book detail page.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("search")}>
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            <Button onClick={() => setStep("edition")}>
              Edition details
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step: Edition Details ─────────────────────────────────────── */}
      {step === "edition" && (
        <div className="space-y-6">
          <div className="space-y-4">
            <Input
              label="ISBN-13"
              id="isbn13"
              value={isbn13}
              onChange={(e) => setIsbn13(e.target.value)}
              placeholder="9780143108269"
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Publisher"
                id="publisher"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
                placeholder="Penguin Classics"
              />
              <Input
                label="Publication year"
                id="publicationYear"
                type="number"
                value={publicationYear}
                onChange={(e) => setPublicationYear(e.target.value)}
                placeholder="2016"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Language"
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                options={LANGUAGE_OPTIONS}
              />
              <Input
                label="Page count"
                id="pageCount"
                type="number"
                value={pageCount}
                onChange={(e) => setPageCount(e.target.value)}
              />
            </div>
            <Select
              label="Binding"
              id="binding"
              value={binding}
              onChange={(e) => setBinding(e.target.value)}
              placeholder="Select binding"
              options={[
                { value: "hardcover", label: "Hardcover" },
                { value: "paperback", label: "Paperback" },
                { value: "leather", label: "Leather" },
                { value: "cloth", label: "Cloth" },
                { value: "boards", label: "Boards" },
                { value: "wrappers", label: "Wrappers" },
                { value: "other", label: "Other" },
              ]}
            />
            <Input
              label="Cover image URL"
              id="coverUrl"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="flex justify-between">
            <Button
              variant="ghost"
              onClick={() =>
                setStep(existingWorkId ? "duplicate" : "details")
              }
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            <div className="flex gap-2">
              {isWishlistStatus && (
                <Button variant="ghost" onClick={() => setStep("categorize")}>
                  <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Skip copies
                </Button>
              )}
              <Button onClick={() => setStep("instance")}>
                {isWishlistStatus ? "Add copies anyway" : "Add copies"}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Instance Creation ───────────────────────────────────── */}
      {step === "instance" && (
        <div className="space-y-6">
          <p className="text-xs text-fg-secondary">
            {isWishlistStatus
              ? "Optionally add copies if you already have this book."
              : "Where do you have this book? Add copies with their locations."}
          </p>

          {locations.length === 0 ? (
            <div className="rounded-sm border border-accent-red/30 bg-accent-red/5 p-4 text-xs text-fg-secondary">
              No locations exist yet. Go to{" "}
              <a href="/locations" className="text-accent-rose underline">
                /locations
              </a>{" "}
              to create one first.
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {instanceDrafts.map((draft, i) => (
                  <InstanceForm
                    key={i}
                    index={i}
                    value={draft}
                    onChange={(d) => updateInstance(i, d)}
                    onRemove={
                      instanceDrafts.length > 1
                        ? () => removeInstance(i)
                        : undefined
                    }
                    locations={locations}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={addInstance}
                className="flex items-center gap-2 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Add another copy
              </button>
            </>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("edition")}>
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            <div className="flex gap-2">
              {!instanceDrafts.some((d) => d.locationId) && (
                <Button variant="ghost" onClick={() => setStep("categorize")}>
                  <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Skip
                </Button>
              )}
              <Button onClick={() => setStep("categorize")}>
                Categorize
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Categorization ──────────────────────────────────────── */}
      {step === "categorize" && (
        <div className="space-y-6">
          <CategorizationForm
            subjects={subjects}
            genres={genres}
            tags={tags}
            collections={collections}
            selectedSubjectIds={selectedSubjectIds}
            selectedGenreIds={selectedGenreIds}
            selectedTagIds={selectedTagIds}
            selectedCollectionIds={selectedCollectionIds}
            onSubjectsChange={setSelectedSubjectIds}
            onGenresChange={setSelectedGenreIds}
            onTagsChange={setSelectedTagIds}
            onCollectionsChange={setSelectedCollectionIds}
          />

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("instance")}>
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("confirm")}>
                <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
                Skip
              </Button>
              <Button onClick={() => setStep("confirm")}>
                Review
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Confirm ─────────────────────────────────────────────── */}
      {step === "confirm" && (
        <div className="space-y-6">
          {/* Work */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-micro font-medium uppercase tracking-wider text-fg-muted">
                    Work
                  </p>
                  <h3 className="mt-1 font-serif text-lg text-fg-primary">
                    {title}
                  </h3>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    {authorName}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {originalYear && (
                      <Badge variant="muted">{originalYear}</Badge>
                    )}
                    <Badge variant="muted">{originalLanguage}</Badge>
                    {seriesName && (
                      <Badge variant="blue">
                        {seriesName}
                        {seriesPosition && ` #${seriesPosition}`}
                      </Badge>
                    )}
                    <Badge
                      variant={
                        catalogueStatus === "accessioned"
                          ? "sage"
                          : catalogueStatus === "wanted" || catalogueStatus === "shortlisted"
                            ? "gold"
                            : "muted"
                      }
                    >
                      {catalogueStatus}
                    </Badge>
                    {acquisitionPriority !== "none" && (
                      <Badge variant="blue">{acquisitionPriority} priority</Badge>
                    )}
                    {existingWorkId && (
                      <Badge variant="gold">Existing work</Badge>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setStep(existingWorkId ? "edition" : "details")
                  }
                >
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Edition */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-micro font-medium uppercase tracking-wider text-fg-muted">
                    Edition
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
                    {isbn13 && (
                      <span className="font-mono">{isbn13}</span>
                    )}
                    {publisher && <span>{publisher}</span>}
                    {publicationYear && (
                      <span className="font-mono">{publicationYear}</span>
                    )}
                    {binding && <Badge variant="muted">{binding}</Badge>}
                    {pageCount && <span>{pageCount} pp.</span>}
                  </div>
                  {coverUrl && (
                    <img
                      src={coverUrl}
                      alt="Cover preview"
                      className="mt-3 h-24 w-16 rounded-sm object-cover"
                    />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("edition")}
                >
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Instances */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-start justify-between">
                <div className="w-full">
                  <p className="text-micro font-medium uppercase tracking-wider text-fg-muted">
                    Copies ({instanceDrafts.filter((d) => d.locationId).length})
                  </p>
                  <div className="mt-2 space-y-2">
                    {instanceDrafts.filter((d) => d.locationId).length === 0 ? (
                      <p className="text-xs text-fg-muted">
                        No copies -- you can add them later from the book detail page.
                      </p>
                    ) : (
                      instanceDrafts
                        .filter((d) => d.locationId)
                        .map((d, i) => {
                          const loc = locations.find(
                            (l) => l.id === d.locationId,
                          );
                          return (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-xs text-fg-secondary"
                            >
                              <span className="text-fg-primary">
                                {loc?.name ?? "Unknown"}
                              </span>
                              {d.format && (
                                <Badge variant="muted">{d.format}</Badge>
                              )}
                              {d.condition && (
                                <Badge variant="sage">
                                  {d.condition.replace(/_/g, " ")}
                                </Badge>
                              )}
                              {d.isSigned && (
                                <Badge variant="gold">Signed</Badge>
                              )}
                              {d.isFirstPrinting && (
                                <Badge variant="gold">1st printing</Badge>
                              )}
                              {d.acquisitionPrice && d.acquisitionCurrency && (
                                <span className="font-mono text-fg-muted">
                                  {d.acquisitionPrice} {d.acquisitionCurrency}
                                </span>
                              )}
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("instance")}
                >
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Categorization */}
          {(selectedSubjectIds.length > 0 ||
            selectedGenreIds.length > 0 ||
            selectedTagIds.length > 0 ||
            selectedCollectionIds.length > 0) && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-micro font-medium uppercase tracking-wider text-fg-muted">
                      Categorization
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedSubjectIds.map((id) => {
                        const s = subjects.find((x) => x.id === id);
                        return s ? (
                          <Badge key={id} variant="default">
                            {s.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedGenreIds.map((id) => {
                        const g = genres.find((x) => x.id === id);
                        return g ? (
                          <Badge key={id} variant="blue">
                            {g.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedTagIds.map((id) => {
                        const t = tags.find((x) => x.id === id);
                        return t ? (
                          <Badge key={id} variant="muted">
                            {t.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedCollectionIds.map((id) => {
                        const c = collections.find((x) => x.id === id);
                        return c ? (
                          <Badge key={id} variant="gold">
                            {c.name}
                          </Badge>
                        ) : null;
                      })}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep("categorize")}
                  >
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("categorize")}>
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              Add to catalogue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
