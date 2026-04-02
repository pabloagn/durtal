"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  InstanceForm,
  EMPTY_INSTANCE,
  type InstanceDraft,
} from "@/components/books/instance-form";
import { createInstance } from "@/lib/actions/instances";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

interface LocationOption {
  id: string;
  name: string;
  type: string;
  subLocations: { id: string; name: string }[];
}

interface InstanceAddDialogProps {
  editionId: string;
  editionTitle: string;
  availableLocations: LocationOption[];
}

export function InstanceAddDialog({
  editionId,
  editionTitle,
  availableLocations,
}: InstanceAddDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<InstanceDraft>({ ...EMPTY_INSTANCE });
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    if (!draft.locationId) {
      toast.error("Location is required");
      return;
    }
    setIsPending(true);
    try {
      await createInstance({
        editionId,
        locationId: draft.locationId,
        subLocationId: draft.subLocationId || null,
        format: draft.format || null,
        condition: draft.condition || null,
        status: (draft.status as "available" | "lent_out" | "in_transit" | "in_storage" | "missing" | "damaged" | "deaccessioned") || "available",
        acquisitionType: draft.acquisitionType || null,
        acquisitionDate: draft.acquisitionDate || null,
        acquisitionSource: draft.acquisitionSource || null,
        acquisitionPrice: draft.acquisitionPrice || null,
        acquisitionCurrency: draft.acquisitionCurrency || null,
        isSigned: draft.isSigned,
        signedBy: draft.signedBy || null,
        inscription: draft.inscription || null,
        isFirstPrinting: draft.isFirstPrinting,
        provenance: draft.provenance || null,
        hasDustJacket: draft.hasDustJacket,
        hasSlipcase: draft.hasSlipcase,
        conditionNotes: draft.conditionNotes || null,
        calibreId: draft.calibreId ? parseInt(draft.calibreId, 10) : null,
        calibreUrl: draft.calibreUrl || null,
        fileSizeBytes: draft.fileSizeBytes ? parseInt(draft.fileSizeBytes, 10) : null,
        notes: draft.notes || null,
        lentTo: draft.lentTo || null,
        lentDate: draft.lentDate || null,
        dispositionType: (draft.dispositionType as "sold" | "donated" | "gifted" | "traded" | "lost" | "stolen" | "destroyed" | "returned" | "expired") || null,
        dispositionDate: draft.dispositionDate || null,
        dispositionTo: draft.dispositionTo || null,
        dispositionPrice: draft.dispositionPrice || null,
        dispositionCurrency: draft.dispositionCurrency || null,
        dispositionNotes: draft.dispositionNotes || null,
      });
      toast.success("Instance added");
      setDraft({ ...EMPTY_INSTANCE });
      setOpen(false);
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Failed to add instance");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setDraft({ ...EMPTY_INSTANCE });
          setOpen(true);
        }}
        className="h-7 gap-1 px-2"
        title={`Add instance for ${editionTitle}`}
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        Add instance
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add Instance"
        description={editionTitle}
      >
        <div className="max-h-[75vh] overflow-y-auto">
          <InstanceForm
            value={draft}
            onChange={setDraft}
            locations={availableLocations}
            index={0}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-glass-border pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !draft.locationId}
          >
            {isPending ? "Creating..." : "Create instance"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
