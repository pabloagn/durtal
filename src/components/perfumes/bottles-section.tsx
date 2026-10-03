"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { deletePerfumeBottle } from "@/lib/actions/perfumes";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { BottleDialog, type EditableBottle, type StorageLocation } from "./bottle-dialog";

/** One container as the section lists it; the page writes its lines */
export interface BottleView {
  id: string;
  /** "Bottle · 75 ml" */
  title: string;
  /** "Eau de Parfum · Held · Study › Shelf 2" */
  line: string;
  /** "Acquired May 3, 2019 · Liberty London · €120.00 · Batch 3K01" */
  details: string | null;
  /** What is left, 0–1, when known */
  share: number | null;
  /** "50 ml left", "Left unknown" */
  left: string;
  disposed: boolean;
  editable: EditableBottle;
}

/** A thin bar of what is left in a container; a dashed one when it is not known */
function Gauge({ share, label }: { share: number | null; label: string }) {
  return (
    <div className="w-32 shrink-0">
      <div
        className={`h-1 overflow-hidden rounded-full ${share === null ? "border border-dashed border-fg-muted/40" : "bg-bg-tertiary"}`}
        role={share === null ? undefined : "meter"}
        aria-valuemin={share === null ? undefined : 0}
        aria-valuemax={share === null ? undefined : 100}
        aria-valuenow={share === null ? undefined : Math.round(share * 100)}
        aria-label={share === null ? undefined : label}
      >
        {share !== null && (
          <div className="h-full bg-accent-sage/70" style={{ width: `${share * 100}%` }} />
        )}
      </div>
      <p className="mt-1.5 font-mono text-micro text-fg-secondary">{label}</p>
    </div>
  );
}

/**
 * The bottles, samples and decants kept of this perfume, those still held
 * first. Each belongs to one formulation; without one, there is nothing to
 * add a bottle to yet.
 */
export function BottlesSection({
  perfumeTitle,
  bottles,
  summary,
  formulations,
  locations,
}: {
  perfumeTitle: string;
  bottles: BottleView[];
  /** "2 bottles, 1 sample" */
  summary: string | null;
  formulations: { id: string; label: string }[];
  locations: StorageLocation[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    { kind: "add" } | { kind: "edit" | "delete"; bottle: BottleView } | null
  >(null);
  const close = () => setDialog(null);
  const target = dialog && dialog.kind !== "add" ? dialog.bottle : null;
  const canAdd = formulations.length > 0;

  return (
    <section className="mb-10" aria-labelledby="perfume-bottles">
      <SectionHeading
        id="perfume-bottles"
        title="Bottles and samples"
        count={bottles.length || undefined}
        description={summary ?? undefined}
        action={
          canAdd && (
            <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "add" })}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Add
            </Button>
          )
        }
      />
      {!canAdd ? (
        <p className="max-w-xl text-sm text-fg-secondary">
          Bottles and samples belong to a formulation. Add a formulation first,
          even one of unknown concentration.
        </p>
      ) : bottles.length === 0 ? (
        <p className="text-sm text-fg-secondary">None kept yet</p>
      ) : (
        <ul className="space-y-2">
          {bottles.map((b) => (
            <li
              key={b.id}
              className={`flex items-start gap-3 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5 ${
                b.disposed ? "opacity-70" : ""
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="type-item-title">{b.title}</p>
                  <p className="mt-0.5 text-sm text-fg-secondary">{b.line}</p>
                  {b.details && (
                    <p className="mt-0.5 text-xs text-fg-secondary">{b.details}</p>
                  )}
                </div>
                <Gauge share={b.share} label={b.left} />
              </div>
              <CapAlignedControls height={32} className="type-item-title">
                <EntityActionMenu
                  items={[
                    { label: "Edit", icon: Pencil, onClick: () => setDialog({ kind: "edit", bottle: b }) },
                    { label: "Delete", icon: Trash2, onClick: () => setDialog({ kind: "delete", bottle: b }), variant: "destructive" },
                  ]}
                />
              </CapAlignedControls>
            </li>
          ))}
        </ul>
      )}

      <BottleDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        onClose={close}
        perfumeTitle={perfumeTitle}
        formulations={formulations}
        locations={locations}
        bottle={dialog?.kind === "edit" ? dialog.bottle.editable : undefined}
      />
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        title="Delete from the collection"
        name={target ? `${perfumeTitle}: ${target.title}` : ""}
        description="Deleting removes it and its history. To keep its record, mark it disposed instead."
        onConfirm={async () => {
          if (!target) return;
          try {
            await deletePerfumeBottle(target.id);
            toast.success("Deleted");
            close();
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete");
          }
        }}
      />
    </section>
  );
}
