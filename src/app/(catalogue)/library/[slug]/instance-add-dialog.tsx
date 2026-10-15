"use client";

import { useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  InstanceForm,
  newCopyDraft,
  instancePayload,
  type InstanceDraft,
} from "@/components/books/instance-form";
import { createInstance } from "@/lib/actions/instances";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { newCopyLocationId } from "@/lib/utils/instance-drafts";
import { EbookPicker } from "@/components/ebooks/ebook-picker";
import { ReviewDecisionControls } from "@/components/ebooks/review-confirm";
import { initialReviewDecision, reviewDecisionReducer } from "@/lib/ebooks/review-queue/decision-state";
import { reviewCopyMetadata } from "@/lib/ebooks/review-queue/copy-draft";
import { notifyReviewOutcome } from "@/lib/ebooks/review-queue/feedback";
import { prepareReviewUi, confirmReviewUi } from "@/lib/actions/ebook-review-ui";
import type { PreparedReview, ReviewOutcome, ReviewQueueRow, ReviewUiResult } from "@/lib/ebooks/review-queue/types";

interface LocationOption {
  id: string;
  name: string;
  type: string;
  isActive?: boolean;
  subLocations: { id: string; name: string }[];
}

interface InstanceAddDialogProps {
  workId: string;
  editionId: string;
  editionTitle: string;
  availableLocations: LocationOption[];
}

export function InstanceAddDialog({
  workId,
  editionId,
  editionTitle,
  availableLocations,
}: InstanceAddDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // A new copy starts with the defaults from Settings, General
  const appSettings = useAppSettings();
  const freshDraft = () =>
    newCopyDraft(
      appSettings,
      newCopyLocationId(availableLocations, appSettings.newCopyLocationId),
    );
  const [draft, setDraft] = useState<InstanceDraft>(freshDraft);
  const [isPending, setIsPending] = useState(false);
  const [ebook, setEbook] = useState<ReviewQueueRow | null>(null);
  const [review, dispatch] = useReducer(reviewDecisionReducer, initialReviewDecision);
  const generation = useRef(0); const writeLock = useRef(false);
  const chosenLocation = availableLocations.find((location) => location.id === draft.locationId);
  const digitalLocation = chosenLocation?.type === "digital" && chosenLocation.isActive !== false;
  const canLink = digitalLocation && ["ebook", "epub", "pdf"].includes(draft.format) && draft.status === "available";

  function close() {
    if (writeLock.current || review.phase === "unknown") return;
    dispatch({ type: "edit", generation: ++generation.current }); setIsPending(false); setOpen(false);
  }

  async function handleSubmit() {
    if (writeLock.current || isPending || review.phase === "unknown") return;
    if (!draft.locationId) {
      toast.error("Location is required");
      return;
    }
    if (ebook) {
      if (!canLink || !ebook.stamp) { toast.error("Choose an available digital copy at a digital location, or clear the selected eBook."); return; }
      const current = ++generation.current; setIsPending(true);
      dispatch({ type: "prepare", generation: current });
      const result: ReviewUiResult<PreparedReview> = await prepareReviewUi({ stamp: ebook.stamp, intent: {
        action: "link", ebookId: ebook.id, workId, choice: { kind: "add_copy", editionId },
        locationId: draft.locationId, newCopyDraft: reviewCopyMetadata(instancePayload(draft)),
      } }).catch(() => ({ ok: false, error: { code: "unavailable", message: "The preview could not be loaded. Your copy details are kept.", retryOriginal: false } }));
      dispatch({ type: "prepared", generation: current, result });
      if (current === generation.current) setIsPending(false);
      return;
    }
    writeLock.current = true;
    setIsPending(true);
    try {
      await createInstance({ editionId, ...instancePayload(draft) });
      toast.success("Instance added");
      setDraft(freshDraft());
      setOpen(false);
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Failed to add instance");
    } finally {
      writeLock.current = false;
      setIsPending(false);
    }
  }

  async function confirmEbook() {
    if (!review.prepared || writeLock.current || !["prepared", "unknown"].includes(review.phase)) return;
    const prepared = review.prepared; const current = review.generation;
    writeLock.current = true; dispatch({ type: "confirm" });
    const result: ReviewUiResult<ReviewOutcome> = await confirmReviewUi({ request: prepared.request, previewToken: prepared.previewToken })
      .catch(() => ({ ok: false, error: { code: "outcome_unknown_retry_original", message: "Retry this same copy decision to confirm its outcome.", retryOriginal: true } }));
    dispatch({ type: "confirmed", generation: current, result }); writeLock.current = false;
    if (!result.ok) return;
    notifyReviewOutcome(result.value, () => { router.refresh(); triggerActivityRefresh(); });
    setDraft(freshDraft()); setEbook(null); setOpen(false); router.refresh(); triggerActivityRefresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          if (writeLock.current || review.phase === "unknown") return;
          setDraft(freshDraft());
          setEbook(null); setIsPending(false);
          dispatch({ type: "edit", generation: ++generation.current });
          setOpen(true);
        }}
        data-tooltip={`Add instance for ${editionTitle}`}
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        Add instance
      </Button>

      <Dialog
        draft
        open={open}
        onClose={close}
        title="Add Instance"
        description={editionTitle}
      >
        <fieldset disabled={isPending || review.prepared !== null || review.phase === "confirming"} className="max-h-[75vh] overflow-y-auto">
          <InstanceForm
            value={draft}
            onChange={setDraft}
            locations={availableLocations}
            index={0}
            ebookField={(canLink || ebook) ? <div className="space-y-2">
              <p className="type-label">eBook</p>
              <EbookPicker value={ebook} disabled={isPending || review.prepared !== null} onChange={setEbook} />
              {ebook && !canLink && <p className="text-xs text-accent-red-text">Return to an available digital copy at a digital location, or clear this eBook.</p>}
            </div> : null}
          />
        </fieldset>
        {review.prepared ? <div className="mt-4 space-y-4 border-t border-glass-border pt-4">
          <ReviewDecisionControls state={review} onClose={close} onConfirm={() => void confirmEbook()}
            onEdit={() => dispatch({ type: "edit", generation: ++generation.current })} />
        </div> : <>
        {review.error && <p role="alert" className="mt-3 text-sm text-accent-red-text">{review.error}</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-glass-border pt-4">
          <Button data-dismiss=""
            variant="secondary"
            size="sm"
            onClick={close}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            busy={isPending}
            disabled={!draft.locationId}
          >
            {ebook ? "Preview copy and eBook" : "Create instance"}
          </Button>
        </div>
        </>}
      </Dialog>
    </>
  );
}
