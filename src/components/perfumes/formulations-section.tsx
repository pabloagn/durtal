"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageIcon, Pencil, Plus, Trash2, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { MediaManagerDialog } from "@/components/books/media-manager-dialog";
import { deletePerfumeVariant } from "@/lib/actions/perfumes";
import { PerfumeImage } from "./perfume-image";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import {
  FormulationDialog,
  type EditableFormulation,
  type FormulationVocabulary,
} from "./formulation-dialog";
import { BottleDialog, type StorageLocation } from "./bottle-dialog";

/** One formulation as the section lists it */
export interface FormulationView {
  id: string;
  name: string;
  image: { s3Key: string; thumbnailS3Key: string | null; tone: string | null } | null;
  /** "1925 to 2001 · Jacques Guerlain · Its own notes · 1 bottle", or "None kept" */
  facts: string;
  containers: number;
  listings: number;
  /** Its page address: the perfume with this formulation chosen */
  href: string;
  editable: EditableFormulation;
}

/**
 * The formulations of a perfume: each concentration as sold, chosen to see
 * its notes and perfumers, with its own image, bottles and listings.
 */
export function FormulationsSection({
  perfume,
  formulations,
  selectedId,
  clearHref,
  vocabularies,
  inherited,
  sources,
  locations,
}: {
  perfume: { id: string; title: string };
  formulations: FormulationView[];
  selectedId: string | null;
  /** The page with no formulation chosen */
  clearHref: string;
  vocabularies: FormulationVocabulary[];
  inherited: { perfumers: string; notes: string; vocabularies: Record<string, string> };
  sources: { id: string; label: string }[];
  locations: StorageLocation[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    | { kind: "add" }
    | { kind: "edit" | "images" | "delete" | "bottle"; formulation: FormulationView }
    | null
  >(null);
  const close = () => setDialog(null);
  const target = dialog && dialog.kind !== "add" ? dialog.formulation : null;

  return (
    <section className="mb-10" aria-labelledby="perfume-formulations">
      <SectionHeading
        id="perfume-formulations"
        title="Formulations"
        count={formulations.length || undefined}
        description={
          formulations.length > 1
            ? "Choose one to see its notes and perfumers"
            : undefined
        }
        action={
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "add" })}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Add formulation
          </Button>
        }
      />
      {formulations.length === 0 ? (
        <p className="max-w-xl text-sm text-fg-secondary">
          No formulations yet. A formulation is a concentration as sold, such as
          Eau de Parfum or Extrait; bottles and samples belong to one.
        </p>
      ) : (
        <ul className="space-y-2">
          {formulations.map((f) => {
            const selected = f.id === selectedId;
            return (
              <li
                key={f.id}
                className={`flex items-start gap-3 rounded-sm border px-3 py-2.5 transition-colors ${
                  selected
                    ? "border-accent-rose/30 bg-accent-plum/15"
                    : "border-glass-border bg-bg-secondary/40"
                }`}
              >
                {/* The picture centers on the name and facts beside it */}
                <PerfumeImage
                  image={f.image}
                  title={f.name}
                  small
                  className="h-12 w-12 shrink-0 self-center rounded-sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="type-item-title">
                    <Link
                      href={selected ? clearHref : f.href}
                      scroll={false}
                      aria-current={selected ? "true" : undefined}
                      className="transition-colors hover:text-accent-rose-text"
                    >
                      {f.name}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-sm text-fg-secondary">{f.facts}</p>
                </div>
                <CapAlignedControls height={32} className="type-item-title">
                  <EntityActionMenu
                    items={[
                      { label: "Edit", icon: Pencil, onClick: () => setDialog({ kind: "edit", formulation: f }) },
                      { label: "Add a bottle or sample", icon: FlaskConical, onClick: () => setDialog({ kind: "bottle", formulation: f }) },
                      { label: "Images", icon: ImageIcon, onClick: () => setDialog({ kind: "images", formulation: f }) },
                      { label: "Delete", icon: Trash2, onClick: () => setDialog({ kind: "delete", formulation: f }), variant: "destructive" },
                    ]}
                  />
                </CapAlignedControls>
              </li>
            );
          })}
        </ul>
      )}

      <FormulationDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        onClose={close}
        perfumeId={perfume.id}
        perfumeTitle={perfume.title}
        formulation={dialog?.kind === "edit" ? dialog.formulation.editable : undefined}
        vocabularies={vocabularies}
        inherited={inherited}
        sources={sources}
      />
      <BottleDialog
        open={dialog?.kind === "bottle"}
        onClose={close}
        perfumeTitle={perfume.title}
        formulations={formulations.map((f) => ({ id: f.id, label: f.name }))}
        locations={locations}
        initialFormulationId={target?.id}
      />
      {target && (
        <MediaManagerDialog
          open={dialog?.kind === "images"}
          onClose={close}
          entityType="perfume_variant"
          entityId={target.id}
          title={`${perfume.title}: ${target.name}`}
          slot="square"
        />
      )}
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        title="Delete formulation"
        name={target ? `${perfume.title}: ${target.name}` : ""}
        description="The formulation, its own notes, perfumers and images are deleted. This cannot be undone."
        blockers={[
          ...(target?.containers
            ? [`It has ${target.containers} ${target.containers === 1 ? "bottle or sample" : "bottles and samples"}: delete ${target.containers === 1 ? "it" : "them"} or move ${target.containers === 1 ? "it" : "them"} to another formulation first.`]
            : []),
          ...(target?.listings
            ? [`It has ${target.listings} retailer ${target.listings === 1 ? "listing" : "listings"}: delete ${target.listings === 1 ? "it" : "them"} first.`]
            : []),
        ]}
        onConfirm={async () => {
          if (!target) return;
          try {
            await deletePerfumeVariant(target.id);
            toast.success("Formulation deleted");
            close();
            // The page shows the fragrance again when its formulation is gone
            if (target.id === selectedId) router.replace(clearHref, { scroll: false });
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the formulation");
          }
        }}
      />
    </section>
  );
}
