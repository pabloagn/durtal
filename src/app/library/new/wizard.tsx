"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import type { PickerPurpose } from "@/lib/reading/book-picker";
import type { SearchResult } from "@/lib/api/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { newCopyDraft, type InstanceDraft } from "@/components/books/instance-form";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { findDuplicateWork } from "@/lib/actions/works";
import { createBookFromWizard, isIsbnInUse } from "@/lib/actions/wizard";
import { fastTrackBook } from "@/lib/actions/fast-track";
import { draftsToCreate } from "@/lib/utils/instance-drafts";
import {
  cameFromApp,
  editionInput,
  emptyTaxonomy,
  fromSearchResult,
  isWishlistStatus,
  newEditionDraft,
  newWorkDraft,
  wizardBookInput,
  workInput,
  type DuplicateWork,
  type EditionDraft,
  type MetadataSource,
  type Step,
  type TaxonomySelection,
  type WorkDraft,
} from "./wizard-model";
import { useWizardOptions } from "./use-wizard-options";
import { StepProgress } from "./step-progress";
import { SearchStep } from "./steps/search-step";
import { DuplicateStep } from "./steps/duplicate-step";
import { DetailsStep } from "./steps/details-step";
import { EditionStep } from "./steps/edition-step";
import { CopiesStep } from "./steps/copies-step";
import { CategorizeStep } from "./steps/categorize-step";
import { ConfirmStep } from "./steps/confirm-step";

/**
 * Add a book: search (or enter by hand), the work, its edition, the copies,
 * categorization and a review. The book is saved in one write at the end, or
 * from the work's step with Fast Track. Each step is in `./steps`; the book
 * being added lives here, so a step left and opened again keeps its values.
 */
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
  const search = useDebouncedSearch(300);
  const { setQuery: setSearchQuery, clearResults } = search;

  // A query or an ISBN from the link: search for it at once
  useEffect(() => {
    const first = initialIsbn ?? initialQuery;
    if (first) setSearchQuery(first);
  }, [initialIsbn, initialQuery, setSearchQuery]);

  // Duplicate detection
  const [duplicateWork, setDuplicateWork] = useState<DuplicateWork | null>(null);
  const [existingWorkId, setExistingWorkId] = useState<string | null>(null);

  // The book being added
  const [work, setWork] = useState<WorkDraft>(() => newWorkDraft(appSettings));
  const [edition, setEdition] = useState<EditionDraft>(() =>
    newEditionDraft(appSettings, initialIsbn),
  );
  const [isbnClash, setIsbnClash] = useState<string | null>(null);
  // The search result it came from
  const [source, setSource] = useState<MetadataSource>({ source: "", sourceId: "" });
  const updateWork = (patch: Partial<WorkDraft>) => setWork((w) => ({ ...w, ...patch }));
  const updateEdition = (patch: Partial<EditionDraft>) => setEdition((e) => ({ ...e, ...patch }));

  const wishlist = isWishlistStatus(work.catalogueStatus);

  // Instance drafts
  const [instanceDrafts, setInstanceDrafts] = useState<InstanceDraft[]>(() => [
    newCopyDraft(appSettings),
  ]);
  // True when the user chose to skip copies: no copy is created on submit,
  // whatever the drafts hold (the book is not owned yet).
  const [skipCopies, setSkipCopies] = useState(false);
  const copiesToCreate = draftsToCreate(instanceDrafts, skipCopies);

  // Categorization
  const [taxonomy, setTaxonomy] = useState<TaxonomySelection>(emptyTaxonomy);

  // What the steps choose from, loaded when a step first needs it
  const { recommenders, locations, lists, defaultLocationId } = useWizardOptions(
    step,
    appSettings.newCopyLocationId,
  );

  // Pre-select the default location only on the copies step. Filling it on
  // later steps would turn an untouched draft into a copy the user skipped.
  useEffect(() => {
    if (step !== "instance" || !defaultLocationId) return;
    setInstanceDrafts((prev) =>
      prev.map((d) => (d.locationId ? d : { ...d, locationId: defaultLocationId })),
    );
  }, [step, defaultLocationId]);

  // ── Search ───────────────────────────────────────────────────────────────

  function selectResult(result: SearchResult) {
    clearResults();
    const filled = fromSearchResult(result, appSettings.newBookLanguage);
    updateWork(filled.work);
    setEdition(filled.edition);
    setSource(filled.source);
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

  function handleFastTrack() {
    // A synchronous guard covers rapid clicks before React disables the button.
    if (
      existingWorkId ||
      fastTrackInFlight.current ||
      !work.title.trim() ||
      !work.authorName.trim()
    )
      return;
    fastTrackInFlight.current = true;
    setFastTrackSaving(true);
    setFastTrackError(null);
    startTransition(async () => {
      try {
        const result = await fastTrackBook({
          authorName: work.authorName,
          work: workInput(work, source),
          edition: {
            ...editionInput(work.title, edition, source),
            // Do not silently discard a malformed identifier in the shortcut.
            isbn13: edition.isbn13.replace(/[\s-]/g, "") || undefined,
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
      const result = await createBookFromWizard(
        wizardBookInput({
          work,
          edition,
          source,
          existingWorkId,
          taxonomy,
          copies: copiesToCreate,
        }),
      );
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
    const clean = edition.isbn13.replace(/[\s-]/g, "");
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

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    // Enter goes to the next step (on Details, it runs Fast Track); ⌘Enter
    // runs Fast Track or adds the book
    <div className="max-w-2xl" data-shortcut-scope="">
      <StepProgress step={step} disabled={fastTrackSaving} onStep={setStep} />

      {step === "search" && (
        <SearchStep
          search={search}
          onSelect={selectResult}
          onManual={() => setStep("details")}
          cancel={cancelButton()}
        />
      )}

      {step === "duplicate" && duplicateWork && (
        <DuplicateStep
          duplicateWork={duplicateWork}
          onAddEdition={() => {
            setExistingWorkId(duplicateWork.id);
            setStep("edition");
          }}
          onNewWork={() => {
            setExistingWorkId(null);
            setStep("details");
          }}
          cancel={cancelButton()}
        />
      )}

      {step === "details" && (
        <DetailsStep
          work={work}
          onChange={updateWork}
          recommenders={recommenders}
          addingEdition={!!existingWorkId}
          fastTrackSaving={fastTrackSaving}
          fastTrackError={fastTrackError}
          onFastTrack={handleFastTrack}
          onBack={() => setStep("search")}
          onNext={() => setStep("edition")}
          cancel={cancelButton("mr-auto")}
        />
      )}

      {step === "edition" && (
        <EditionStep
          edition={edition}
          onChange={(patch) => {
            updateEdition(patch);
            if (patch.isbn13 !== undefined) setIsbnClash(null);
          }}
          isbnClash={isbnClash}
          wishlist={wishlist}
          checking={isPending}
          onBack={() => setStep(existingWorkId ? "duplicate" : "details")}
          onLeave={leaveEdition}
          cancel={cancelButton("mr-auto")}
        />
      )}

      {step === "instance" && (
        <CopiesStep
          drafts={instanceDrafts}
          onDraftsChange={setInstanceDrafts}
          newDraft={() => newCopyDraft(appSettings, defaultLocationId)}
          locations={locations}
          wishlist={wishlist}
          onBack={() => setStep("edition")}
          onSkip={() => {
            setSkipCopies(true);
            setStep("categorize");
          }}
          onNext={() => {
            setSkipCopies(false);
            setStep("categorize");
          }}
          cancel={cancelButton("mr-auto")}
        />
      )}

      {step === "categorize" && (
        <CategorizeStep
          lists={lists}
          taxonomy={taxonomy}
          onChange={(key, ids) => setTaxonomy((t) => ({ ...t, [key]: ids }))}
          onBack={() => setStep(skipCopies ? "edition" : "instance")}
          onNext={() => setStep("confirm")}
          cancel={cancelButton("mr-auto")}
        />
      )}

      {step === "confirm" && (
        <ConfirmStep
          work={work}
          edition={edition}
          existingWork={!!existingWorkId}
          copies={copiesToCreate}
          locations={locations}
          taxonomy={taxonomy}
          lists={lists}
          saving={isPending}
          onEdit={setStep}
          onEditCopies={() => {
            setSkipCopies(false);
            setStep("instance");
          }}
          onBack={() => setStep("categorize")}
          onSubmit={handleSubmit}
          cancel={cancelButton("mr-auto")}
        />
      )}
    </div>
  );
}
