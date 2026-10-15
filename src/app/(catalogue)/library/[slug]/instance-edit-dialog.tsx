"use client";

import { useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InstanceForm, instancePayload, type InstanceDraft } from "@/components/books/instance-form";
import { updateInstance } from "@/lib/actions/instances";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import type { Instance, Location, SubLocation } from "@/lib/types/index";
import { EbookPicker } from "@/components/ebooks/ebook-picker";
import { ReviewDecisionControls } from "@/components/ebooks/review-confirm";
import { readReviewExistingCopyUi } from "@/lib/actions/ebook-review-copy-ui";
import { readReviewWorkOptions, prepareReviewUi, confirmReviewUi } from "@/lib/actions/ebook-review-ui";
import { initialReviewDecision, reviewDecisionReducer } from "@/lib/ebooks/review-queue/decision-state";
import { existingCopyDraft, existingCopyChanges, sameExistingCopyStamp, COPY_RESERVED_FIELDS, COPY_METADATA_FIELDS, COPY_METADATA_LABELS,
  type ReviewExistingCopyContext } from "@/lib/ebooks/review-queue/existing-copy";
import { notifyReviewOutcome } from "@/lib/ebooks/review-queue/feedback";
import type { ReviewQueueRow } from "@/lib/ebooks/review-queue/types";

type InstanceWithLocation = Instance & {
  location: Location;
  subLocation: SubLocation | null;
};

interface LocationOption {
  id: string;
  name: string;
  type: string;
  subLocations: { id: string; name: string }[];
}

interface InstanceEditDialogProps {
  instance: InstanceWithLocation;
  editionId: string;
  availableLocations: LocationOption[];
  workId?: string;
  canLinkEbook?: boolean;
}

function instanceToDraft(instance: InstanceWithLocation): InstanceDraft {
  return {
    locationId: instance.locationId ?? "",
    subLocationId: instance.subLocationId ?? "",
    format: instance.format ?? "",
    condition: instance.condition ?? "",
    status: instance.status ?? "available",
    acquisitionType: instance.acquisitionType ?? "",
    acquisitionDate: instance.acquisitionDate ?? "",
    acquisitionSource: instance.acquisitionSource ?? "",
    acquisitionPrice: String(instance.acquisitionPrice ?? ""),
    acquisitionCurrency: instance.acquisitionCurrency ?? "",
    isSigned: instance.isSigned ?? false,
    signedBy: instance.signedBy ?? "",
    inscription: instance.inscription ?? "",
    isFirstPrinting: instance.isFirstPrinting ?? false,
    provenance: instance.provenance ?? "",
    hasDustJacket: instance.hasDustJacket ?? null,
    hasSlipcase: instance.hasSlipcase ?? null,
    conditionNotes: instance.conditionNotes ?? "",
    fileSizeBytes: instance.fileSizeBytes != null ? String(instance.fileSizeBytes) : "",
    notes: instance.notes ?? "",
    lentTo: instance.lentTo ?? "",
    lentDate: instance.lentDate ?? "",
    dispositionType: instance.dispositionType ?? "",
    dispositionDate: instance.dispositionDate ?? "",
    dispositionTo: instance.dispositionTo ?? "",
    dispositionPrice: String(instance.dispositionPrice ?? ""),
    dispositionCurrency: instance.dispositionCurrency ?? "",
    dispositionNotes: instance.dispositionNotes ?? "",
  };
}

export function InstanceEditDialog({
  instance,
  editionId,
  availableLocations,
  workId,
  canLinkEbook = false,
}: InstanceEditDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<InstanceDraft>(() => instanceToDraft(instance));
  const [isPending, setIsPending] = useState(false);
  const [context, setContext] = useState<ReviewExistingCopyContext | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [ebook, setEbook] = useState<ReviewQueueRow | null>(null), [choiceReady, setChoiceReady] = useState(false);
  const [review, dispatch] = useReducer(reviewDecisionReducer, initialReviewDecision);
  const generation = useRef(0), writeLock = useRef(false);
  const locked = isPending || review.phase === "confirming" || review.phase === "unknown";
  const fieldsDisabled = locked || loading || review.phase === "preparing" || review.prepared !== null;

  function close() {
    if (writeLock.current || locked) return;
    generation.current++; setOpen(false);
  }
  async function openEditor() {
    if (writeLock.current || open) return;
    const current = ++generation.current;
    setDraft(instanceToDraft(instance)); setContext(null); setEbook(null); setChoiceReady(false); setError(null); setLoading(false);
    dispatch({ type: "edit", generation: current }); setOpen(true);
    if (!workId || !canLinkEbook) return;
    setLoading(true);
    const result = await readReviewExistingCopyUi({ workId, editionId, instanceId: instance.id }).catch(() => null);
    if (current !== generation.current) return;
    if (result?.ok) { setContext(result.value); setDraft(existingCopyDraft(result.value)); }
    else setError("This copy could not be loaded for edit and Link. You can still save ordinary copy edits.");
    setLoading(false);
  }
  async function selectEbook(row: ReviewQueueRow | null) {
    if (fieldsDisabled) return;
    const current = ++generation.current; setEbook(row); setChoiceReady(false); setError(null);
    dispatch({ type: "edit", generation: current });
    if (!row || !context || !workId) return;
    setLoading(true);
    const result = await readReviewWorkOptions({ workId, ebookId: row.id }).catch(() => null);
    if (current !== generation.current) return;
    const copy = result?.ok ? result.value.editions.find((edition) => edition.id === editionId)?.copies.find((copy) => copy.id === instance.id) : null;
    if (copy?.canFill && sameExistingCopyStamp(copy.stamp, context.stamp)) setChoiceReady(true);
    else setError("This copy changed or cannot take the selected eBook. Your edits are kept. Reload the copy before preparing another Link.");
    setLoading(false);
  }
  async function prepareLink() {
    if (!workId || !context || !ebook?.stamp || !choiceReady || fieldsDisabled || writeLock.current) return;
    const change = existingCopyChanges(instancePayload(existingCopyDraft(context)), instancePayload(draft));
    if (change.reserved.length) { setError("Link keeps this copy’s location, sub-location and status, and sets its digital fields. Restore those choices or clear the eBook to save them separately."); return; }
    const current = ++generation.current; setError(null); dispatch({ type: "prepare", generation: current });
    const result = await prepareReviewUi({ stamp: ebook.stamp, intent: { action: "link", ebookId: ebook.id, workId,
      choice: { kind: "fill_copy", editionId, instanceId: instance.id }, existingCopyPatch: change.patch, expectedCopyStamp: context.stamp } })
      .catch(() => ({ ok: false as const, error: { code: "unavailable" as const, message: "The preview could not be prepared. Your edits are kept.", retryOriginal: false } }));
    dispatch({ type: "prepared", generation: current, result });
  }
  async function reloadCopy() {
    if (!context || !workId || fieldsDisabled || writeLock.current) return;
    const previous = instancePayload(existingCopyDraft(context)), chosen = instancePayload(draft), savedDraft = draft;
    const changed = [...COPY_METADATA_FIELDS, ...COPY_RESERVED_FIELDS].filter((key) => previous[key] !== chosen[key]);
    const current = ++generation.current; setLoading(true); setChoiceReady(false); setError(null);
    dispatch({ type: "edit", generation: current });
    const result = await readReviewExistingCopyUi({ workId, editionId, instanceId: instance.id }).catch(() => null);
    if (current !== generation.current) return;
    if (!result?.ok) { setLoading(false); setError("The current copy could not be reloaded. Your draft is kept."); return; }
    const fresh = result.value;
    setContext(fresh); setDraft({ ...existingCopyDraft(fresh), ...Object.fromEntries(changed.map((key) => [key, savedDraft[key]])) });
    if (ebook) {
      const options = await readReviewWorkOptions({ workId, ebookId: ebook.id }).catch(() => null);
      if (current !== generation.current) return;
      const copy = options?.ok ? options.value.editions.find((edition) => edition.id === editionId)?.copies.find((copy) => copy.id === instance.id) : null;
      if (copy?.canFill && sameExistingCopyStamp(copy.stamp, fresh.stamp)) setChoiceReady(true);
      else setError("The selected copy changed again. Your draft is kept.");
    }
    setLoading(false);
  }
  async function confirmLink() {
    if (!review.prepared || writeLock.current || !["prepared", "unknown"].includes(review.phase)) return;
    const exact = review.prepared, current = review.generation;
    writeLock.current = true; dispatch({ type: "confirm" });
    const result = await confirmReviewUi({ request: exact.request, previewToken: exact.previewToken })
      .catch(() => ({ ok: false as const, error: { code: "outcome_unknown_retry_original" as const, message: "Retry this exact edit and Link decision.", retryOriginal: true } }));
    writeLock.current = false; dispatch({ type: "confirmed", generation: current, result });
    if (!result.ok) return;
    notifyReviewOutcome(result.value, () => router.refresh()); setOpen(false); router.refresh(); triggerActivityRefresh();
  }

  async function handleSubmit() {
    if (ebook) { await prepareLink(); return; }
    if (writeLock.current || fieldsDisabled) return;
    if (!draft.locationId) {
      toast.error("Location is required");
      return;
    }
    writeLock.current = true; setIsPending(true);
    try {
      await updateInstance(instance.id, instancePayload(draft));
      toast.success("Instance updated");
      setOpen(false);
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Failed to update instance");
    } finally {
      writeLock.current = false; setIsPending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void openEditor()}
        data-tooltip="Edit instance"
      >
        <Pencil className="h-4 w-4" strokeWidth={1.5} />
        Edit
      </Button>

      <Dialog
        draft
        open={open}
        onClose={close}
        title="Edit Instance"
      >
        {loading && <p role="status" className="mb-3 text-sm text-fg-secondary">Loading current copy…</p>}
        <fieldset disabled={fieldsDisabled} className="max-h-[75vh] overflow-y-auto">
          <InstanceForm
            value={draft}
            onChange={setDraft}
            locations={availableLocations}
            index={0}
            ebookField={context ? <EbookPicker value={ebook} disabled={fieldsDisabled} onChange={(row) => void selectEbook(row)} /> : null}
          />
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-accent-red-text">{error}</p>}
        {context && !fieldsDisabled && <Button size="sm" variant="ghost" onClick={() => void reloadCopy()}>Reload current copy and keep my changed fields</Button>}
        {ebook && context && !fieldsDisabled && existingCopyChanges(instancePayload(existingCopyDraft(context)), instancePayload(draft)).reserved.length > 0 &&
          <Button size="sm" onClick={() => { const original = existingCopyDraft(context); setDraft((current) => ({ ...current,
            ...Object.fromEntries(COPY_RESERVED_FIELDS.map((key) => [key, original[key]])) })); setError(null); }}>Restore location, status and digital choices</Button>}
        {review.prepared && <div className="mt-4 space-y-3 border-t border-glass-border pt-4">
          {review.prepared.request.action === "link" && review.prepared.request.existingCopyPatch &&
            <div className="space-y-2 text-sm text-fg-secondary"><p>Saves these copy changes together with this Link:</p>
              <ul className="space-y-1">{Object.entries(review.prepared.request.existingCopyPatch).map(([key, value]) =>
                <li key={key} className="whitespace-pre-wrap break-words">{COPY_METADATA_LABELS[key as typeof COPY_METADATA_FIELDS[number]]}: {value === null ? "Clear" : value === true ? "Yes" : value === false ? "No" : String(value)}</li>)}</ul>
            </div>}
          <ReviewDecisionControls state={review} onClose={close} onConfirm={() => void confirmLink()}
            onEdit={() => dispatch({ type: "edit", generation: ++generation.current })} />
        </div>}
        {!review.prepared && <>
        {review.error && <p role="alert" className="mt-3 text-sm text-accent-red-text">{review.error}</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-glass-border pt-4">
          <Button data-dismiss=""
            variant="secondary"
            size="sm"
            onClick={close}
            disabled={locked}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={fieldsDisabled || !draft.locationId || (!!ebook && !choiceReady)}
            busy={isPending || review.phase === "preparing"}
          >
            {ebook ? "Preview edits and Link" : "Save"}
          </Button>
        </div></>}
      </Dialog>
    </>
  );
}
