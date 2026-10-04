"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { deleteFilmHolding } from "@/lib/actions/films";
import {
  CopyDialog,
  type CopyLocation,
  type EditableCopy,
  type VersionChoice,
} from "./copy-dialog";

/** One copy as the section lists it; the page writes its lines */
export interface CopyView {
  id: string;
  /** "Blu-ray", "Physical copy" */
  title: string;
  /** "Theatrical · Held · Study › Shelf 2" */
  line: string;
  /** "Acquired 2017 · Film Shop · €25.00 · Sealed" */
  details: string | null;
  disposed: boolean;
  editable: EditableCopy;
}

/**
 * The copies of this film in the collection, those still held first: discs,
 * prints and files. Curating or watching a film never needs one.
 */
export function CopiesSection({
  film,
  copies,
  summary,
  versions,
  locations,
}: {
  film: { id: string; title: string };
  copies: CopyView[];
  /** "1 physical copy, 1 digital copy" */
  summary: string | null;
  versions: VersionChoice[];
  locations: CopyLocation[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    { kind: "add" } | { kind: "edit" | "delete"; copy: CopyView } | null
  >(null);
  const close = () => setDialog(null);
  const target = dialog && dialog.kind !== "add" ? dialog.copy : null;

  return (
    <section className="mb-10" aria-labelledby="film-copies">
      <SectionHeading
        id="film-copies"
        title="Copies"
        count={copies.length || undefined}
        description={summary ?? undefined}
        action={
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "add" })}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Add copy
          </Button>
        }
      />
      {copies.length === 0 ? (
        <p className="text-sm text-fg-secondary">None in the collection</p>
      ) : (
        <ul className="space-y-2">
          {copies.map((c) => (
            <li
              key={c.id}
              className={`flex items-start gap-3 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5 ${
                c.disposed ? "opacity-70" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="type-item-title">{c.title}</p>
                <p className="mt-0.5 text-sm text-fg-secondary">{c.line}</p>
                {c.details && <p className="mt-0.5 text-xs text-fg-secondary">{c.details}</p>}
              </div>
              <CapAlignedControls height={32} className="type-item-title">
                <EntityActionMenu
                  items={[
                    { label: "Edit", icon: Pencil, onClick: () => setDialog({ kind: "edit", copy: c }) },
                    { label: "Delete", icon: Trash2, onClick: () => setDialog({ kind: "delete", copy: c }), variant: "destructive" },
                  ]}
                />
              </CapAlignedControls>
            </li>
          ))}
        </ul>
      )}

      <CopyDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        onClose={close}
        filmId={film.id}
        filmTitle={film.title}
        versions={versions}
        locations={locations}
        copy={dialog?.kind === "edit" ? dialog.copy.editable : undefined}
      />
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        title="Delete copy"
        name={target ? `${film.title}: ${target.title}` : ""}
        description="Deleting removes the copy and its history. To keep its record, mark it disposed instead."
        onConfirm={async () => {
          if (!target) return;
          try {
            await deleteFilmHolding(target.id);
            toast.success("Copy deleted");
            close();
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the copy");
          }
        }}
      />
    </section>
  );
}
