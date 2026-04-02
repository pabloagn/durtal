"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { updateInstance } from "@/lib/actions/instances";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { INSTANCE_STATUSES } from "@/lib/types/index";

interface InstanceStatusButtonProps {
  instanceId: string;
  currentStatus: string;
}

export function InstanceStatusButton({
  instanceId,
  currentStatus,
}: InstanceStatusButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [lentTo, setLentTo] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPendingStatus(null);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function applyStatus(status: string, extraFields?: Record<string, unknown>) {
    setIsPending(true);
    try {
      await updateInstance(instanceId, { status: status as "available" | "lent_out" | "in_transit" | "in_storage" | "missing" | "damaged" | "deaccessioned", ...extraFields });
      toast.success("Status updated");
      setOpen(false);
      setPendingStatus(null);
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Failed to update status");
    } finally {
      setIsPending(false);
    }
  }

  function handleStatusSelect(status: string) {
    if (status === currentStatus) {
      setOpen(false);
      return;
    }
    if (status === "lent_out") {
      setPendingStatus("lent_out");
      return;
    }
    void applyStatus(status);
  }

  function handleLentToSubmit(e: React.FormEvent) {
    e.preventDefault();
    void applyStatus("lent_out", {
      lentTo: lentTo || null,
      lentDate: new Date().toISOString().slice(0, 10),
    });
  }

  const statusColorClass = (() => {
    switch (currentStatus) {
      case "available":
        return "text-fg-secondary border-glass-border";
      case "lent_out":
      case "missing":
      case "damaged":
      case "deaccessioned":
        return "text-accent-red border-accent-red/30";
      case "in_transit":
      case "in_storage":
        return "text-fg-muted border-glass-border";
      default:
        return "text-fg-muted border-glass-border";
    }
  })();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className={`inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-xs transition-colors hover:bg-bg-tertiary disabled:opacity-50 ${statusColorClass}`}
      >
        {currentStatus.replace(/_/g, " ")}
        <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-0.5 min-w-[160px] rounded-sm border border-glass-border bg-bg-secondary shadow-lg">
          {pendingStatus === "lent_out" ? (
            <form onSubmit={handleLentToSubmit} className="p-3 space-y-2">
              <p className="text-xs font-medium text-fg-secondary">Lent to</p>
              <input
                type="text"
                value={lentTo}
                onChange={(e) => setLentTo(e.target.value)}
                placeholder="Name (optional)..."
                className="h-7 w-full rounded-sm border border-glass-border bg-bg-primary px-2 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
                autoFocus
              />
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 rounded-sm bg-accent-rose/10 px-2 py-1 text-xs text-accent-rose hover:bg-accent-rose/20 disabled:opacity-50"
                >
                  {isPending ? "..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingStatus(null)}
                  className="rounded-sm px-2 py-1 text-xs text-fg-muted hover:text-fg-secondary"
                >
                  Back
                </button>
              </div>
            </form>
          ) : (
            INSTANCE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleStatusSelect(s)}
                disabled={isPending}
                className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-bg-tertiary disabled:opacity-50 ${
                  s === currentStatus
                    ? "text-accent-rose"
                    : "text-fg-secondary"
                }`}
              >
                {s.replace(/_/g, " ")}
                {s === currentStatus && (
                  <span className="ml-1 text-fg-muted">(current)</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
