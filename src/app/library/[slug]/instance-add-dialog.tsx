"use client";

import { useState } from "react";
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
  // A new copy starts with the defaults from Settings, General
  const appSettings = useAppSettings();
  const freshDraft = () =>
    newCopyDraft(
      appSettings,
      newCopyLocationId(availableLocations, appSettings.newCopyLocationId),
    );
  const [draft, setDraft] = useState<InstanceDraft>(freshDraft);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    if (!draft.locationId) {
      toast.error("Location is required");
      return;
    }
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
      setIsPending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setDraft(freshDraft());
          setOpen(true);
        }}
        className="h-7 gap-1 whitespace-nowrap px-2"
        data-tooltip={`Add instance for ${editionTitle}`}
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
