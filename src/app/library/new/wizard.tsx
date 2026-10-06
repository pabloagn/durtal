"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  SkipForward,
  ImageIcon,
} from "lucide-react";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import { isbn10To13, validIsbn10 } from "@/lib/match/plan";
import type { PickerPurpose } from "@/lib/reading/book-picker";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TitleInput } from "@/components/shared/title-input";
import { CapAligned } from "@/components/shared/cap-aligned";
import { AuthorNameInput } from "@/components/shared/author-name-input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  InstanceForm,
  newCopyDraft,
  type InstanceDraft,
} from "@/components/books/instance-form";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { CategorizationForm } from "@/components/books/categorization-form";
import { LANGUAGES } from "@/lib/constants/languages";
import { languageName, normalizeLanguage } from "@/lib/utils/language";
import { bindingLabel } from "@/lib/utils/binding";
import { catalogueStatusLabel, enumLabel, priorityLabel } from "@/lib/utils/labels";
import { BINDING_TYPES } from "@/lib/types/index";
import { findDuplicateWork } from "@/lib/actions/works";
import { createBookFromWizard, isIsbnInUse } from "@/lib/actions/wizard";
import { fastTrackBook } from "@/lib/actions/fast-track";
import { stripHtmlToText } from "@/lib/utils/sanitize";
import type { CreateWorkInput } from "@/lib/validations";
import { getRecommenders } from "@/lib/actions/recommenders";
import { getLocations } from "@/lib/actions/locations";
import {
  getSubjects,
  getGenres,
  getTags,
  getCategories,
  getThemes,
  getLiteraryMovements,
  getArtTypes,
  getArtMovements,
  getKeywords,
  getAttributes,
} from "@/lib/actions/taxonomy";
import { getCollections } from "@/lib/actions/collections";
import {
  draftsToCreate,
  newCopyLocationId,
} from "@/lib/utils/instance-drafts";
import { isComposing } from "@/lib/shortcuts/shortcuts";

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
  /** One of BINDING_TYPES, when the source names a printed binding */
  binding?: string;
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

/**
 * Whether the page before this one is a page of this app: the wizard was
 * reached by an in-app link (the document was loaded at another address), or
 * the document was loaded from one of our pages.
 */
function cameFromApp(): boolean {
  const [loaded] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  if (loaded && new URL(loaded.name).pathname !== location.pathname) return true;
  try {
    return (
      !!document.referrer &&
      new URL(document.referrer).origin === location.origin
    );
  } catch {
    return false;
  }
}

// ── Wizard ───────────────────────────────────────────────────────────────────

export function AddBookWizard({
  initialQuery = null,
  initialIsbn = null,
  then = null,
}: {
  /** From the reading book picker's "Not in Durtal?" link (SLN-448) */
  initialQuery?: string | null;
  initialIsbn?: string | null;
  /** The reading dialog the new book's page opens */
  then?: PickerPurpose | null;
}) {
  const router = useRouter();
  // The book page opens the reading dialog it was added for
  const bookHref = (slug: string) => `/library/${slug}${then ? `?then=${then}` : ""}`;
  // Defaults for the new book and its copies (Settings, General)
  const appSettings = useAppSettings();
  const [isPending, startTransition] = useTransition();
  const fastTrackInFlight = useRef(false);
  const [fastTrackSaving, setFastTrackSaving] = useState(false);
  const [fastTrackError, setFastTrackError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("search");

  // Search autocomplete
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    notices: searchNotices,
    isSearching,
    clearResults,
  } = useDebouncedSearch(300);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // A query or an ISBN from the link: search for it at once
  useEffect(() => {
    const first = initialIsbn ?? initialQuery;
    if (first) setSearchQuery(first);
  }, [initialIsbn, initialQuery, setSearchQuery]);

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchResults]);

  // Close dropdown on outside click
  useEffect(() => {
    if (step !== "search") return;
    function handleClickOutside(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        clearResults();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [step, clearResults]);

  // Duplicate detection
  const [duplicateWork, setDuplicateWork] = useState<DuplicateWork | null>(null);
  const [existingWorkId, setExistingWorkId] = useState<string | null>(null);

  // Work fields
  const [title, setTitle] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [originalYear, setOriginalYear] = useState("");
  const [originalLanguage, setOriginalLanguage] = useState(appSettings.newBookLanguage);
  const [description, setDescription] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [seriesPosition, setSeriesPosition] = useState("");
  const [catalogueStatus, setCatalogueStatus] = useState<string>(appSettings.newBookStatus);
  const [acquisitionPriority, setAcquisitionPriority] = useState("none");
  const [selectedRecommenderIds, setSelectedRecommenderIds] = useState<string[]>([]);
  const [allRecommenders, setAllRecommenders] = useState<{ id: string; name: string }[]>([]);

  const isWishlistStatus = ["tracked", "shortlisted", "wanted"].includes(catalogueStatus);

  // Edition fields
  // An ISBN from the link also fills the field, for details entered by hand
  const [isbn13, setIsbn13] = useState(() => {
    if (!initialIsbn) return "";
    const ten = initialIsbn.length === 10 ? validIsbn10(initialIsbn) : null;
    return ten ? isbn10To13(ten) : initialIsbn;
  });
  const [isbnClash, setIsbnClash] = useState<string | null>(null);
  const [publisher, setPublisher] = useState("");
  const [publicationYear, setPublicationYear] = useState("");
  const [language, setLanguage] = useState(appSettings.newBookLanguage);
  const [pageCount, setPageCount] = useState("");
  const [binding, setBinding] = useState("");
  const [coverUrl, setCoverUrl] = useState("");

  // External source tracking
  const [metadataSource, setMetadataSource] = useState("");
  const [metadataSourceId, setMetadataSourceId] = useState("");

  // Instance drafts
  const [instanceDrafts, setInstanceDrafts] = useState<InstanceDraft[]>(() => [
    newCopyDraft(appSettings),
  ]);
  // True when the user chose to skip copies: no copy is created on submit,
  // whatever the drafts hold (the book is not owned yet).
  const [skipCopies, setSkipCopies] = useState(false);
  const copiesToCreate = draftsToCreate(instanceDrafts, skipCopies);

  // Categorization
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [selectedGenreIds, setSelectedGenreIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedThemeIds, setSelectedThemeIds] = useState<string[]>([]);
  const [selectedLiteraryMovementIds, setSelectedLiteraryMovementIds] = useState<string[]>([]);
  const [selectedArtTypeIds, setSelectedArtTypeIds] = useState<string[]>([]);
  const [selectedArtMovementIds, setSelectedArtMovementIds] = useState<string[]>([]);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<string[]>([]);
  const [selectedAttributeIds, setSelectedAttributeIds] = useState<string[]>([]);

  // Reference data (fetched once)
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [subjects, setSubjects] = useState<RefDataItem[]>([]);
  const [genres, setGenres] = useState<RefDataItem[]>([]);
  const [tags, setTags] = useState<RefDataItem[]>([]);
  const [collections, setCollections] = useState<RefDataItem[]>([]);
  const [categories, setCategories] = useState<RefDataItem[]>([]);
  const [themes, setThemes] = useState<RefDataItem[]>([]);
  const [literaryMovements, setLiteraryMovements] = useState<RefDataItem[]>([]);
  const [artTypes, setArtTypes] = useState<RefDataItem[]>([]);
  const [artMovements, setArtMovements] = useState<RefDataItem[]>([]);
  const [keywords, setKeywords] = useState<RefDataItem[]>([]);
  const [attributes, setAttributes] = useState<RefDataItem[]>([]);
  const [refDataLoaded, setRefDataLoaded] = useState(false);
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [recommendersLoaded, setRecommendersLoaded] = useState(false);

  // Fetch recommenders when details step is reached
  useEffect(() => {
    if (recommendersLoaded) return;
    if (step !== "details" && step !== "confirm") return;
    setRecommendersLoaded(true);
    getRecommenders().then((data) => {
      setAllRecommenders(data.map((r) => ({ id: r.id, name: r.name })));
    });
  }, [step, recommendersLoaded]);

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
      getCategories(),
      getThemes(),
      getLiteraryMovements(),
      getArtTypes(),
      getArtMovements(),
      getKeywords(),
      getAttributes(),
    ]).then(([locs, subs, gens, tgs, cols, cats, thms, litMvs, artTps, artMvs, kwds, attrs]) => {
      const mappedLocations = locs.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        subLocations: l.subLocations.map((s) => ({
          id: s.id,
          name: s.name,
        })),
      }));
      setLocations(mappedLocations);
      setDefaultLocationId(
        newCopyLocationId(mappedLocations, appSettings.newCopyLocationId),
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
      setCategories(cats.map((c) => ({ id: c.id, name: c.name })));
      setThemes(thms.map((t) => ({ id: t.id, name: t.name })));
      setLiteraryMovements(litMvs.map((m) => ({ id: m.id, name: m.name })));
      setArtTypes(artTps.map((t) => ({ id: t.id, name: t.name })));
      setArtMovements(artMvs.map((m) => ({ id: m.id, name: m.name })));
      setKeywords(kwds.map((k) => ({ id: k.id, name: k.name })));
      setAttributes(attrs.map((a) => ({ id: a.id, name: a.name })));
    });
  }, [step, refDataLoaded, appSettings.newCopyLocationId]);

  // Pre-select the default location only on the copies step. Filling it on
  // later steps would turn an untouched draft into a copy the user skipped.
  useEffect(() => {
    if (step !== "instance" || !defaultLocationId) return;
    setInstanceDrafts((prev) =>
      prev.map((d) => (d.locationId ? d : { ...d, locationId: defaultLocationId })),
    );
  }, [step, defaultLocationId]);

  // ── Search ───────────────────────────────────────────────────────────────

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (!searchResults.length && e.key !== "Escape") return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((i) =>
          i < searchResults.length - 1 ? i + 1 : i,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((i) => (i > 0 ? i - 1 : i));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && searchResults[highlightedIndex]) {
          selectResult(searchResults[highlightedIndex]);
        }
        break;
      case "Escape":
        // Open results close first; with none, Esc leaves the field
        if (!searchResults.length || isComposing(e)) break;
        e.preventDefault();
        clearResults();
        setHighlightedIndex(-1);
        break;
    }
  }

  function selectResult(result: SearchResult) {
    clearResults();
    setTitle(result.title);
    setAuthorName(result.authors[0] ?? "");
    setOriginalYear(String(result.publicationYear ?? ""));
    setOriginalLanguage(normalizeLanguage(result.language) ?? appSettings.newBookLanguage);
    setDescription(stripHtmlToText(result.description ?? ""));
    setIsbn13(result.isbn13 ?? "");
    setPublisher(result.publisher ?? "");
    setPublicationYear(String(result.publicationYear ?? ""));
    setLanguage(normalizeLanguage(result.language) ?? appSettings.newBookLanguage);
    setPageCount(String(result.pageCount ?? ""));
    setBinding(result.binding ?? "");
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

  // Both entry points use the same Details values and edition defaults.
  function workDetails() {
    return {
      title: title.trim(),
      originalLanguage,
      originalYear: originalYear ? parseInt(originalYear, 10) : undefined,
      description: description || undefined,
      seriesName: seriesName || undefined,
      seriesPosition: seriesPosition || undefined,
      catalogueStatus: catalogueStatus as CreateWorkInput["catalogueStatus"],
      acquisitionPriority:
        acquisitionPriority as CreateWorkInput["acquisitionPriority"],
      recommenderIds:
        selectedRecommenderIds.length > 0 ? selectedRecommenderIds : undefined,
      metadataSource: metadataSource || undefined,
      metadataSourceId: metadataSourceId || undefined,
    };
  }

  function editionDetails() {
    const cleanIsbn = isbn13.replace(/-/g, "");
    return {
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
    };
  }

  function handleFastTrack() {
    // A synchronous guard covers rapid clicks before React disables the button.
    if (
      existingWorkId ||
      fastTrackInFlight.current ||
      !title.trim() ||
      !authorName.trim()
    )
      return;
    fastTrackInFlight.current = true;
    setFastTrackSaving(true);
    setFastTrackError(null);
    startTransition(async () => {
      try {
        const result = await fastTrackBook({
          authorName,
          work: workDetails(),
          edition: {
            ...editionDetails(),
            // Do not silently discard a malformed identifier in the shortcut.
            isbn13: isbn13.replace(/[\s-]/g, "") || undefined,
          },
        });
        if (!result.ok) {
          setFastTrackError(result.error);
          fastTrackInFlight.current = false;
          setFastTrackSaving(false);
          return;
        }
        toast.success("Book added to catalogue");
        if (result.coverUnavailable)
          toast.warning(
            "The cover could not be downloaded. Its source URL was saved.",
          );
        // Keep the guard until navigation completes, including no-ISBN books.
        router.push(bookHref(result.slug));
      } catch {
        setFastTrackError("Could not add the book. Please try again.");
        fastTrackInFlight.current = false;
        setFastTrackSaving(false);
      }
    });
  }

  async function handleSubmit() {
    startTransition(async () => {
      // One write: the author, work, taxonomy, edition, copies and collection
      // links are all saved, or nothing is
      const result = await createBookFromWizard({
        authorName: authorName.trim(),
        existingWorkId: existingWorkId || null,
        work: existingWorkId ? undefined : workDetails(),
        taxonomy: existingWorkId
          ? undefined
          : {
              subjectIds: selectedSubjectIds,
              categoryIds: selectedCategoryIds,
              themeIds: selectedThemeIds,
              literaryMovementIds: selectedLiteraryMovementIds,
              artTypeIds: selectedArtTypeIds,
              artMovementIds: selectedArtMovementIds,
              keywordIds: selectedKeywordIds,
              attributeIds: selectedAttributeIds,
            },
        edition: {
          ...editionDetails(),
          genreIds: selectedGenreIds.length > 0 ? selectedGenreIds : undefined,
          tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        },
        copies: copiesToCreate.map((draft) => ({
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
        })),
        collectionIds: selectedCollectionIds,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Book added to catalogue");
      if (result.coverUnavailable)
        toast.warning(
          "The cover could not be downloaded. Its source URL was saved.",
        );
      router.push(bookHref(result.slug ?? ""));
    });
  }

  /**
   * Leaves the edition step only when no other edition has its ISBN, so a
   * duplicate shows here and not after the copies and categorization.
   */
  function leaveEdition(next: "instance" | "categorize") {
    const clean = isbn13.replace(/[\s-]/g, "");
    startTransition(async () => {
      const clash = clean
        ? await isIsbnInUse(clean)
        : { inUse: false as const };
      if (clash.inUse) {
        setIsbnClash(
          `Another edition already has this ISBN${clash.title ? ` ("${clash.title}")` : ""}. Open that book to add a copy.`,
        );
        return;
      }
      setIsbnClash(null);
      setSkipCopies(next === "categorize");
      setStep(next);
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
    setInstanceDrafts((prev) => [...prev, newCopyDraft(appSettings, defaultLocationId)]);
  }

  // ── Cancel ───────────────────────────────────────────────────────────────

  // Nothing is saved before Fast Track or "Add to catalogue", so leaving is
  // enough: back to the app page the user came from, else the library. Never
  // back to another site (a bookmark has no page of ours before), and never a
  // back with no page at all (a tab opened with Cmd+click on "Add book").
  function cancel() {
    if (window.history.length > 1 && cameFromApp()) router.back();
    else router.push("/library");
  }

  // In a footer, `mr-auto` keeps Cancel beside Back when the row wraps
  const cancelButton = (className?: string) => (
    <Button
      variant="ghost"
      className={className}
      disabled={fastTrackSaving || isPending}
      onClick={cancel}
    >
      Cancel
    </Button>
  );

  // ── Step progress ────────────────────────────────────────────────────────

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  // "duplicate" step is not in STEPS — it's a transient step

  function StepProgress() {
    const currentIdx = step === "duplicate" ? 0 : stepIndex;
    return (
      <div className="mb-6">
        {/* Six labels need about 600px: a narrow screen shows the current
            step and a bar, as the order dialog does */}
        <div className="sm:hidden">
          <p className="text-micro font-medium text-accent-rose-text">
            Step {currentIdx + 1} of {STEPS.length} — {STEPS[currentIdx].label}
          </p>
          <div className="mt-1 flex gap-1.5">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                aria-label={s.label}
                disabled={i >= currentIdx || fastTrackSaving}
                onClick={() => setStep(s.key)}
                className="flex-1 py-1.5"
              >
                <span
                  className={`block h-0.5 rounded-full transition-colors duration-300 ${
                    i < currentIdx
                      ? "bg-accent-sage"
                      : i === currentIdx
                        ? "bg-accent-rose/60"
                        : "bg-bg-tertiary"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          {STEPS.map((s, i) => {
            const isCompleted = i < currentIdx;
            const isCurrent =
              s.key === step || (step === "duplicate" && i === 0);
            return (
              <div key={s.key} className="flex items-center gap-1">
                {i > 0 && (
                  <div
                    className={`h-px w-4 ${isCompleted ? "bg-accent-sage" : "bg-bg-tertiary"}`}
                  />
                )}
                <button
                  type="button"
                  disabled={!isCompleted || fastTrackSaving}
                  onClick={() => isCompleted && setStep(s.key)}
                  className={`flex items-center gap-1 rounded-sm px-2 py-1 text-micro font-medium transition-colors ${
                    isCurrent
                      ? "bg-accent-plum text-accent-rose-text"
                      : isCompleted
                        ? "text-fg-secondary hover:text-fg-primary cursor-pointer"
                        : "text-fg-secondary cursor-default"
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
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    // Enter goes to the next step (on Details, it runs Fast Track); ⌘Enter
    // runs Fast Track or adds the book
    <div className="max-w-2xl" data-shortcut-scope="">
      <StepProgress />

      {/* ── Step: Search ──────────────────────────────────────────────── */}
      {step === "search" && (
        <div className="space-y-6">
          <div ref={searchContainerRef} className="relative">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
              <input
                type="text"
                placeholder="Search by title, author, or ISBN..."
                data-shortcut-search=""
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="h-9 w-full rounded-sm border border-glass-border bg-bg-primary pl-9 pr-9 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none pointer-coarse:h-11"
                autoFocus
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fg-muted" />
              )}
            </div>

            {/* Autocomplete dropdown */}
            {searchQuery.trim().length >= 2 &&
              (searchResults.length > 0 || isSearching || searchNotices.length > 0) && (
                // The glass never scrolls: its list does, inside it
                <div className="glass absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden">
                  <div className="max-h-[420px] overflow-y-auto">
                    {/* A source that could not answer, so "no results" is not misread */}
                    {!isSearching &&
                      searchNotices.map((notice) => (
                        <p
                          key={notice}
                          role="status"
                          className="border-b border-glass-border/50 px-3 py-2.5 text-xs text-fg-secondary"
                        >
                          {notice}
                        </p>
                      ))}
                    {searchResults.map((result, i) => (
                      <button
                        key={`${result.source}-${result.sourceId}-${i}`}
                        className={`flex w-full items-start gap-3 border-b border-glass-border/50 px-3 py-2.5 text-left transition-colors last:border-0 ${
                          highlightedIndex === i
                            ? "bg-bg-tertiary"
                            : "hover:bg-bg-tertiary"
                        }`}
                        onClick={() => selectResult(result)}
                        onMouseEnter={() => setHighlightedIndex(i)}
                      >
                        {/* Cover thumbnail */}
                        <div className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded-sm bg-bg-primary">
                          {result.coverUrl ? (
                            <img
                              src={result.coverUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <ImageIcon
                                className="h-3 w-3 text-fg-muted/40"
                                strokeWidth={1.5}
                              />
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="min-w-0 flex-1">
                          <h3 className="type-item-title line-clamp-1">
                            {result.title}
                          </h3>
                          <p className="mt-0.5 line-clamp-1 text-xs text-fg-secondary">
                            {result.authors.join(", ") || "Unknown author"}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            {result.publicationYear && (
                              <span className="font-mono text-micro text-fg-secondary">
                                {result.publicationYear}
                              </span>
                            )}
                            {result.publisher && (
                              <span className="line-clamp-1 text-micro text-fg-secondary">
                                {result.publisher}
                              </span>
                            )}
                            <Badge variant="muted">
                              {result.source === "isbndb"
                                ? "ISBNdb"
                                : result.source.replace("_", " ")}
                            </Badge>
                          </div>
                        </div>

                        {/* On the cap-height center of the title's first line */}
                        <CapAligned height={14} className="type-item-title">
                          <ArrowRight
                            className="h-3.5 w-3.5 text-fg-muted"
                            strokeWidth={1.5}
                          />
                        </CapAligned>
                      </button>
                    ))}

                    {isSearching && searchResults.length === 0 && (
                      <div className="flex items-center gap-2 px-3 py-4">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />
                        <span className="text-xs text-fg-secondary">
                          Searching...
                        </span>
                      </div>
                    )}

                    {!isSearching && searchResults.length === 0 &&
                      searchQuery.trim().length >= 2 && (
                        <div className="px-3 py-4 text-xs text-fg-secondary">
                          No books found. Try a different search or enter details
                          manually.
                        </div>
                      )}
                  </div>
                </div>
              )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-glass-border pt-4">
            <button
              onClick={() => setStep("details")}
              className="flex items-center gap-2 text-sm text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Enter details manually
            </button>
            {cancelButton()}
          </div>
        </div>
      )}

      {/* ── Step: Duplicate Detection ─────────────────────────────────── */}
      {step === "duplicate" && duplicateWork && (
        <div className="space-y-6">
          <div className="rounded-sm border border-accent-gold/30 bg-accent-gold/5 p-4">
            <h3 className="type-item-title">
              Possible duplicate found
            </h3>
            <p className="mt-1 text-xs text-fg-secondary">
              A work with a similar title and author already exists in your
              catalogue.
            </p>
          </div>

          <Card>
            <CardContent className="py-4">
              <h3 className="type-item-title">
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

          <div className="flex flex-wrap gap-3">
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
            {cancelButton()}
          </div>
        </div>
      )}

      {/* ── Step: Work Details ────────────────────────────────────────── */}
      {step === "details" && (
        <fieldset
          disabled={fastTrackSaving}
          className="min-w-0 space-y-6"
          aria-busy={fastTrackSaving}
        >
          <div className="space-y-4">
            <TitleInput
              label="Title"
              id="title"
              value={title}
              onValueChange={setTitle}
              language={originalLanguage}
              placeholder="The Master and Margarita"
              required
              autoFocus
            />
            <AuthorNameInput
              label="Author"
              id="author"
              value={authorName}
              onValueChange={setAuthorName}
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

            <div>
              <label htmlFor="wizard-recommender" className="type-label mb-1.5 block">
                Recommended by
              </label>
              {selectedRecommenderIds.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {selectedRecommenderIds.map((id) => {
                    const r = allRecommenders.find((x) => x.id === id);
                    return r ? (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-sm bg-bg-tertiary px-2 py-0.5 text-xs text-fg-secondary"
                      >
                        {r.name}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedRecommenderIds((prev) =>
                              prev.filter((x) => x !== id),
                            )
                          }
                          className="ml-0.5 text-fg-secondary hover:text-fg-primary"
                        >
                          x
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}
              <select
                id="wizard-recommender"
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (val && !selectedRecommenderIds.includes(val)) {
                    setSelectedRecommenderIds((prev) => [...prev, val]);
                  }
                }}
                className="h-9 w-full appearance-none rounded-sm border border-glass-border bg-bg-secondary px-3 text-sm text-fg-primary transition-colors focus:border-accent-rose focus:outline-none"
              >
                <option value="">Add recommender...</option>
                {allRecommenders
                  .filter((r) => !selectedRecommenderIds.includes(r.id))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="border-t border-bg-tertiary pt-4 mt-2">
              <p className="type-caption mb-3">
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
                <p className="mt-2 text-xs text-fg-secondary">
                  You can add copies later from the book detail page.
                </p>
              )}
            </div>
          </div>

          {fastTrackError && (
            <p role="alert" className="text-sm text-accent-red-text">
              {fastTrackError}
            </p>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("search")}>
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            {cancelButton("mr-auto")}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              {!existingWorkId && (
                <Button
                  type="button"
                  variant="primary"
                  data-shortcut="next"
                  onClick={handleFastTrack}
                  disabled={fastTrackSaving || !title.trim() || !authorName.trim()}
                  data-tooltip="Save now, skipping copies and categorization"
                  data-tooltip-keys="enter"
                >
                  {fastTrackSaving && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                  )}
                  Fast Track
                </Button>
              )}
              <Button
                data-shortcut={existingWorkId ? "next" : undefined}
                onClick={() => setStep("edition")}
              >
                Edition details
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          </div>
        </fieldset>
      )}

      {/* ── Step: Edition Details ─────────────────────────────────────── */}
      {step === "edition" && (
        <div className="space-y-6">
          <div className="space-y-4">
            <Input
              label="ISBN-13"
              id="isbn13"
              value={isbn13}
              onChange={(e) => {
                setIsbn13(e.target.value);
                setIsbnClash(null);
              }}
              placeholder="9780143108269"
              error={isbnClash ?? undefined}
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
              options={BINDING_TYPES.map((b) => ({
                value: b,
                label: bindingLabel(b)!,
              }))}
            />
            <Input
              label="Cover image URL"
              id="coverUrl"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="flex flex-wrap justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                setStep(existingWorkId ? "duplicate" : "details")
              }
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            {cancelButton("mr-auto")}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              {isWishlistStatus && (
                <Button
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => leaveEdition("categorize")}
                >
                  <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Skip copies
                </Button>
              )}
              <Button
                data-shortcut="next"
                disabled={isPending}
                onClick={() => leaveEdition("instance")}
              >
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
              <a href="/locations" className="text-accent-rose-text underline">
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

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("edition")}>
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            {cancelButton("mr-auto")}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setSkipCopies(true);
                  setStep("categorize");
                }}
              >
                <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
                Skip copies
              </Button>
              <Button
                data-shortcut="next"
                onClick={() => {
                  setSkipCopies(false);
                  setStep("categorize");
                }}
              >
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
            categories={categories}
            themes={themes}
            literaryMovements={literaryMovements}
            artTypes={artTypes}
            artMovements={artMovements}
            keywords={keywords}
            attributes={attributes}
            selectedSubjectIds={selectedSubjectIds}
            selectedGenreIds={selectedGenreIds}
            selectedTagIds={selectedTagIds}
            selectedCollectionIds={selectedCollectionIds}
            selectedCategoryIds={selectedCategoryIds}
            selectedThemeIds={selectedThemeIds}
            selectedLiteraryMovementIds={selectedLiteraryMovementIds}
            selectedArtTypeIds={selectedArtTypeIds}
            selectedArtMovementIds={selectedArtMovementIds}
            selectedKeywordIds={selectedKeywordIds}
            selectedAttributeIds={selectedAttributeIds}
            onSubjectsChange={setSelectedSubjectIds}
            onGenresChange={setSelectedGenreIds}
            onTagsChange={setSelectedTagIds}
            onCollectionsChange={setSelectedCollectionIds}
            onCategoriesChange={setSelectedCategoryIds}
            onThemesChange={setSelectedThemeIds}
            onLiteraryMovementsChange={setSelectedLiteraryMovementIds}
            onArtTypesChange={setSelectedArtTypeIds}
            onArtMovementsChange={setSelectedArtMovementIds}
            onKeywordsChange={setSelectedKeywordIds}
            onAttributesChange={setSelectedAttributeIds}
          />

          <div className="flex flex-wrap justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => setStep(skipCopies ? "edition" : "instance")}
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            {cancelButton("mr-auto")}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("confirm")}>
                <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
                Skip
              </Button>
              <Button data-shortcut="next" onClick={() => setStep("confirm")}>
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
                  <p className="type-caption">
                    Work
                  </p>
                  <h3 className="type-item-title mt-1">
                    {title}
                  </h3>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    {authorName}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {originalYear && (
                      <Badge variant="muted">{originalYear}</Badge>
                    )}
                    <Badge variant="muted">{languageName(originalLanguage)}</Badge>
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
                      {catalogueStatusLabel(catalogueStatus)}
                    </Badge>
                    {acquisitionPriority !== "none" && (
                      <Badge variant="blue">{priorityLabel(acquisitionPriority)} priority</Badge>
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
                  <p className="type-caption">
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
                    {binding && <Badge variant="muted">{bindingLabel(binding)}</Badge>}
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
                  <p className="type-caption">
                    Copies ({copiesToCreate.length})
                  </p>
                  <div className="mt-2 space-y-2">
                    {copiesToCreate.length === 0 ? (
                      <p className="text-xs text-fg-secondary">
                        No copies -- you can add them later from the book detail page.
                      </p>
                    ) : (
                      copiesToCreate.map((d, i) => {
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
                              <Badge variant="muted">{enumLabel(d.format)}</Badge>
                            )}
                            {d.condition && (
                              <Badge variant="sage">
                                {enumLabel(d.condition)}
                              </Badge>
                            )}
                            {d.isSigned && (
                              <Badge variant="gold">Signed</Badge>
                            )}
                            {d.isFirstPrinting && (
                              <Badge variant="gold">1st printing</Badge>
                            )}
                            {d.acquisitionPrice && d.acquisitionCurrency && (
                              <span className="font-mono text-fg-secondary">
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
                  onClick={() => {
                    setSkipCopies(false);
                    setStep("instance");
                  }}
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
            selectedCollectionIds.length > 0 ||
            selectedCategoryIds.length > 0 ||
            selectedThemeIds.length > 0 ||
            selectedLiteraryMovementIds.length > 0 ||
            selectedArtTypeIds.length > 0 ||
            selectedArtMovementIds.length > 0 ||
            selectedKeywordIds.length > 0 ||
            selectedAttributeIds.length > 0) && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="type-caption">
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
                      {selectedCategoryIds.map((id) => {
                        const c = categories.find((x) => x.id === id);
                        return c ? (
                          <Badge key={id} variant="sage">
                            {c.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedThemeIds.map((id) => {
                        const t = themes.find((x) => x.id === id);
                        return t ? (
                          <Badge key={id} variant="default">
                            {t.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedLiteraryMovementIds.map((id) => {
                        const m = literaryMovements.find((x) => x.id === id);
                        return m ? (
                          <Badge key={id} variant="blue">
                            {m.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedArtTypeIds.map((id) => {
                        const a = artTypes.find((x) => x.id === id);
                        return a ? (
                          <Badge key={id} variant="muted">
                            {a.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedArtMovementIds.map((id) => {
                        const a = artMovements.find((x) => x.id === id);
                        return a ? (
                          <Badge key={id} variant="muted">
                            {a.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedKeywordIds.map((id) => {
                        const k = keywords.find((x) => x.id === id);
                        return k ? (
                          <Badge key={id} variant="default">
                            {k.name}
                          </Badge>
                        ) : null;
                      })}
                      {selectedAttributeIds.map((id) => {
                        const a = attributes.find((x) => x.id === id);
                        return a ? (
                          <Badge key={id} variant="default">
                            {a.name}
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
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("categorize")}>
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              Back
            </Button>
            {cancelButton("mr-auto")}
            <Button
              variant="primary"
              className="ml-auto"
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
