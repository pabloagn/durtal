"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { ChevronDown } from "lucide-react";
import { updateInstance } from "@/lib/actions/instances";
import { todayLocal } from "@/lib/utils/date";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { DISPOSITION_TYPES, INSTANCE_STATUSES } from "@/lib/types/index";
import { enumLabel } from "@/lib/utils/labels";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import type { UpdateInstanceInput } from "@/lib/validations/instances";

type Status = (typeof INSTANCE_STATUSES)[number];
type DispositionType = (typeof DISPOSITION_TYPES)[number];

interface InstanceStatusButtonProps {
  instanceId: string;
  currentStatus: string;
}

/**
 * A copy's status, and the menu that changes it (SLN-1124). Lent out asks
 * who has it; Deaccessioned asks how the copy left and when, and saves only
 * on its Confirm. Escape closes one layer, and the focus comes back to this
 * button after every change.
 */
export function InstanceStatusButton({
  instanceId,
  currentStatus,
}: InstanceStatusButtonProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [asking, setAsking] = useState<"lent_out" | "deaccessioned" | null>(null);
  const [busy, setBusy] = useState(false);
  // The saved status shows at once, before the page's own refresh brings it
  const [saved, setSaved] = useState<{ status: string; over: string } | null>(null);
  const status = saved && saved.over === currentStatus ? saved.status : currentStatus;

  const [lentTo, setLentTo] = useState("");
  const [disposition, setDisposition] = useState({ type: "", date: "", to: "" });

  async function applyStatus(next: Status, extraFields?: Omit<UpdateInstanceInput, "status">) {
    if (busy) return;
    setBusy(true);
    try {
      await updateInstance(instanceId, { status: next, ...extraFields });
      setSaved({ status: next, over: currentStatus });
      setAsking(null);
      toast.success(`Status: ${enumLabel(next)}`);
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Could not update the status");
    } finally {
      setBusy(false);
    }
  }

  function choose(next: Status) {
    if (next === status) return;
    if (next === "lent_out") {
      setLentTo("");
      setAsking("lent_out");
    } else if (next === "deaccessioned") {
      setDisposition({ type: "", date: todayLocal(), to: "" });
      setAsking("deaccessioned");
    } else {
      void applyStatus(next);
    }
  }

  const statusColorClass = ["lent_out", "missing", "damaged", "deaccessioned"].includes(status)
    ? "text-accent-red-text border-accent-red/30"
    : "text-fg-secondary border-glass-border";

  return (
    <>
      <DropdownMenu
        align="start"
        open={menuOpen}
        // Saving: the menu stays shut until the change is in
        onOpenChange={(open) => setMenuOpen(open && !busy)}
        trigger={
          <button
            type="button"
            aria-label={`Status: ${enumLabel(status)}`}
            aria-busy={busy || undefined}
            className={`inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-xs transition-colors hover:bg-bg-tertiary touch-hit ${statusColorClass}`}
          >
            {enumLabel(status)}
            <ChevronDown className="h-3 w-3" strokeWidth={1.5} aria-hidden />
          </button>
        }
      >
        {INSTANCE_STATUSES.map((s) => (
          <DropdownMenuItem key={s} checked={s === status} onClick={() => choose(s)}>
            {enumLabel(s)}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>

      <Dialog
        open={asking === "lent_out"}
        onClose={() => setAsking(null)}
        title="Lend this copy"
        className="max-w-md"
        expandable={false}
      >
        <form
          id={`lend-${instanceId}`}
          onSubmit={(event) => {
            event.preventDefault();
            void applyStatus("lent_out", { lentTo: lentTo.trim() || null, lentDate: todayLocal() });
          }}
        >
          <Input
            label="Lent to"
            id={`lend-${instanceId}-to`}
            value={lentTo}
            onChange={(event) => setLentTo(event.target.value)}
            placeholder="Name (optional)"
          />
        </form>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button type="submit" form={`lend-${instanceId}`} variant="primary" size="sm" busy={busy}>
            Lend
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={asking === "deaccessioned"}
        onClose={() => setAsking(null)}
        title="Deaccession this copy"
        className="max-w-md"
        expandable={false}
      >
        <div className="space-y-4">
          <Select
            label="Disposition type"
            id={`deaccession-${instanceId}-type`}
            value={disposition.type}
            onChange={(event) => setDisposition((d) => ({ ...d, type: event.target.value }))}
            placeholder="Select..."
            options={DISPOSITION_TYPES.map((t) => ({ value: t, label: enumLabel(t) }))}
          />
          <DatePicker
            label="Disposition date"
            id={`deaccession-${instanceId}-date`}
            value={disposition.date}
            onChange={(date) => setDisposition((d) => ({ ...d, date }))}
            required
            error={disposition.date ? undefined : "Choose the day it left"}
          />
          <Input
            label="Disposed to"
            id={`deaccession-${instanceId}-to`}
            value={disposition.to}
            onChange={(event) => setDisposition((d) => ({ ...d, to: event.target.value }))}
            placeholder="Person or organisation..."
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          {/* Danger: Enter in a field never presses it, only a click or ⌘Enter */}
          <Button
            type="button"
            variant="danger"
            size="sm"
            data-shortcut="save"
            busy={busy}
            disabled={!disposition.date}
            onClick={() =>
              applyStatus("deaccessioned", {
                dispositionType: (disposition.type || null) as DispositionType | null,
                dispositionDate: disposition.date,
                dispositionTo: disposition.to.trim() || null,
              })
            }
          >
            Deaccession
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
