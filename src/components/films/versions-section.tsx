"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Disc3, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu, type EntityActionItem } from "@/components/shared/entity-action-menu";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { deleteFilmVersion, updateFilm } from "@/lib/actions/films";
import { VersionDialog, type EditableVersion } from "./version-dialog";
import { CopyDialog, type CopyLocation, type VersionChoice } from "./copy-dialog";
import type { Choice } from "./film-fields";

/** One version as the section lists it; the page writes its lines */
export interface VersionView {
  id: string;
  /** "Theatrical", "Unnamed version" */
  name: string;
  /** "1h 49m", or null when unknown */
  runtime: string | null;
  notes: string | null;
  /** "United States · Theatrical · Jun 25, 1982 · Universal Pictures" */
  releases: { id: string; line: string; notes: string | null }[];
  /** Copies that name this version or one of its releases */
  copies: number;
  editable: EditableVersion;
}

/**
 * The versions of the film: each cut or edition with its runtime and the
 * releases that brought it to the public, in the order the owner keeps.
 */
export function VersionsSection({
  film,
  versions,
  countries,
  sources,
  versionChoices,
  locations,
  startAdding = false,
}: {
  film: { id: string; title: string; fingerprint: string };
  versions: VersionView[];
  countries: Choice[];
  sources: { id: string; label: string }[];
  versionChoices: VersionChoice[];
  locations: CopyLocation[];
  /** Opens "Add version" at once (`?add=version`, from the new-film prompt) */
  startAdding?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [dialog, setDialog] = useState<
    | { kind: "add" }
    | { kind: "edit" | "delete" | "copy"; version: VersionView }
    | null
  >(startAdding ? { kind: "add" } : null);
  const [moving, setMoving] = useState(false);
  const close = () => {
    setDialog(null);
    if (startAdding) router.replace(pathname, { scroll: false });
  };
  const target = dialog && dialog.kind !== "add" ? dialog.version : null;

  async function move(index: number, step: -1 | 1) {
    const order = versions.map((v) => v.id);
    [order[index], order[index + step]] = [order[index + step], order[index]];
    setMoving(true);
    try {
      await updateFilm(film.id, { versionOrder: order }, film.fingerprint);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not move the version");
    } finally {
      setMoving(false);
    }
  }

  return (
    <section className="mb-10" aria-labelledby="film-versions">
      <SectionHeading
        id="film-versions"
        title="Versions"
        count={versions.length || undefined}
        action={
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "add" })}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Add version
          </Button>
        }
      />
      {versions.length === 0 ? (
        <p className="max-w-xl text-sm text-fg-secondary">
          No versions yet. A version is a cut or edition of this film, such as
          the theatrical cut or a director&apos;s cut, with its runtime and
          releases. A remake is a film of its own.
        </p>
      ) : (
        <ol className="space-y-2">
          {versions.map((v, index) => {
            const items: EntityActionItem[] = [
              { label: "Edit", icon: Pencil, onClick: () => setDialog({ kind: "edit", version: v }) },
              { label: "Add a copy of it", icon: Disc3, onClick: () => setDialog({ kind: "copy", version: v }) },
              ...(index > 0 && !moving
                ? [{ label: "Move up", icon: ArrowUp, onClick: () => move(index, -1) }]
                : []),
              ...(index < versions.length - 1 && !moving
                ? [{ label: "Move down", icon: ArrowDown, onClick: () => move(index, 1) }]
                : []),
              {
                label: "Delete",
                icon: Trash2,
                onClick: () => setDialog({ kind: "delete", version: v }),
                variant: "destructive",
              },
            ];
            return (
              <li
                key={v.id}
                className="flex items-start gap-3 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="type-item-title">
                    {v.name}
                    {v.runtime && (
                      <span className="font-sans text-sm text-fg-secondary"> · {v.runtime}</span>
                    )}
                  </p>
                  {v.notes && <p className="mt-0.5 text-sm text-fg-secondary">{v.notes}</p>}
                  {v.releases.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {v.releases.map((r) => (
                        <li key={r.id} className="text-xs text-fg-secondary">
                          {r.line}
                          {r.notes && <span>: {r.notes}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-fg-secondary">No releases recorded</p>
                  )}
                </div>
                <CapAlignedControls height={32} className="type-item-title">
                  <EntityActionMenu items={items} />
                </CapAlignedControls>
              </li>
            );
          })}
        </ol>
      )}

      <VersionDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        onClose={close}
        filmId={film.id}
        filmTitle={film.title}
        version={dialog?.kind === "edit" ? dialog.version.editable : undefined}
        countries={countries}
        sources={sources}
      />
      <CopyDialog
        open={dialog?.kind === "copy"}
        onClose={close}
        filmId={film.id}
        filmTitle={film.title}
        versions={versionChoices}
        locations={locations}
        initialVersionId={target?.id}
      />
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        title="Delete version"
        name={target ? `${film.title}: ${target.name}` : ""}
        description="The version and its releases are deleted. This cannot be undone."
        blockers={
          target?.copies
            ? [
                `${target.copies === 1 ? "A personal copy names" : `${target.copies} personal copies name`} this version or its releases: delete ${target.copies === 1 ? "it" : "them"} or change ${target.copies === 1 ? "its" : "their"} version first.`,
              ]
            : []
        }
        onConfirm={async () => {
          if (!target) return;
          try {
            await deleteFilmVersion(target.id);
            toast.success("Version deleted");
            close();
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the version");
          }
        }}
      />
    </section>
  );
}
