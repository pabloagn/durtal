"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InstanceForm, instancePayload, type InstanceDraft } from "@/components/books/instance-form";
import { updateInstance } from "@/lib/actions/instances";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import type { Instance, Location, SubLocation } from "@/lib/types/index";

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
  editionId: _editionId,
  availableLocations,
}: InstanceEditDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<InstanceDraft>(() => instanceToDraft(instance));
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    if (!draft.locationId) {
      toast.error("Location is required");
      return;
    }
    setIsPending(true);
    try {
      await updateInstance(instance.id, instancePayload(draft));
      toast.success("Instance updated");
      setOpen(false);
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Failed to update instance");
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
          setDraft(instanceToDraft(instance));
          setOpen(true);
        }}
        data-tooltip="Edit instance"
      >
        <Pencil className="h-4 w-4" strokeWidth={1.5} />
        Edit
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit Instance"
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
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
