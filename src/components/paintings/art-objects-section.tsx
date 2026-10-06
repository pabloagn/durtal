"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  CheckCheck,
  History,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import type { StorageLocation } from "@/components/catalogue/holding-fields";
import { deleteArtObject } from "@/lib/actions/paintings";
import { deleteWhereabouts, verifyWhereabouts } from "@/lib/actions/whereabouts";
import type { ArtObjectKind } from "@/lib/catalogue/painting-labels";
import {
  ArtObjectDialog,
  type EditableArtObject,
  type ReproducibleObject,
} from "./art-object-dialog";
import {
  WhereaboutsDialog,
  type EditableWhereabouts,
  type WhereaboutsMode,
} from "./whereabouts-dialog";

/** One location record as the history lists it; the page writes its lines */
export interface HistoryView {
  id: string;
  /** "Museum of Modern Art" */
  place: string;
  /** "Permanent collection · On display" */
  custody: string | null;
  /** "1941 – now", "Mar 1939 – 1941" */
  period: string;
  certainty: "confirmed" | "probable" | "uncertain";
  occasion: string | null;
  /** "Checked Oct 4, 2026" */
  checked: string | null;
  /** The source the record cites: "Museo del Prado, collection page" */
  source: string | null;
  notes: string | null;
  current: boolean;
  /** Overlaps the current location at another place */
  conflict: boolean;
  editable: EditableWhereabouts;
}

/** One object as the section lists it; the page writes its lines */
export interface ObjectView {
  id: string;
  kind: ArtObjectKind;
  /** "Original", "Version: second version" */
  name: string;
  /** "73.7 × 92.1 cm · 1889 · Attributed to Giorgione" */
  facts: string | null;
  /** "Museum of Modern Art · Lillie P. Bliss Bequest · 472.1941" */
  owner: string;
  /** "Held · Study › Wall · Acquired 2019 · €40.00" for objects you own */
  holding: string | null;
  /** "Reproduces the original" */
  reproduces: string | null;
  notes: string | null;
  disposed: boolean;
  /** Where it is now, and how old that knowledge is */
  now: {
    place: string;
    custody: string | null;
    since: string | null;
    /** "Checked Oct 4, 2026", "Recorded Oct 4, 2026, not checked" */
    checked: string;
    stale: boolean;
    /** The source the current location cites */
    source: string | null;
  } | null;
  history: HistoryView[];
  historyFingerprint: string;
  /** Its last permanent collection venue: where a return goes */
  ownerVenue: { id: string; label: string } | null;
  /** The venue of its current location, to know whether it is away */
  currentVenueId: string | null;
  editable: EditableArtObject;
}

type DialogState =
  | { kind: "add"; objectKind: ArtObjectKind }
  | { kind: "edit" | "delete"; object: ObjectView }
  | { kind: "where"; object: ObjectView; mode: WhereaboutsMode; record?: HistoryView }
  | { kind: "delete-where"; object: ObjectView; record: HistoryView }
  | null;

const CERTAINTY_TEXT = { confirmed: null, probable: "Probable", uncertain: "Uncertain" } as const;

function Line({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`mt-0.5 text-sm text-fg-secondary ${className}`}>{children}</p>;
}

/**
 * The location history of one object, newest first. Confirmed records form
 * one history; probable and uncertain claims are listed with their
 * certainty, and a claim that contradicts the current location is marked.
 */
function HistoryList({
  object,
  onEdit,
  onVerify,
  onDelete,
}: {
  object: ObjectView;
  onEdit: (record: HistoryView) => void;
  onVerify: (record: HistoryView) => void;
  onDelete: (record: HistoryView) => void;
}) {
  if (!object.history.length) return null;
  return (
    <details className="group mt-3 border-t border-glass-border pt-2" open={object.history.length <= 3}>
      <summary className="cursor-pointer list-none text-xs leading-6 text-fg-secondary transition-colors hover:text-fg-primary touch-hit">
        Location history ({object.history.length})
      </summary>
      <ol className="mt-1 space-y-2">
        {object.history.map((record) => (
          <li key={record.id} className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg-primary">
                {record.place}
                {CERTAINTY_TEXT[record.certainty] && (
                  <span className="text-fg-secondary"> · {CERTAINTY_TEXT[record.certainty]}</span>
                )}
                {record.conflict && (
                  <span className="text-accent-gold"> · Contradicts the current location</span>
                )}
              </p>
              <p className="text-xs text-fg-secondary">
                {[
                  record.period,
                  record.custody,
                  record.occasion,
                  record.checked,
                  record.source ? `Source: ${record.source}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {record.notes && <p className="text-xs text-fg-secondary">{record.notes}</p>}
            </div>
            <CapAlignedControls height={32} className="text-sm">
              <EntityActionMenu
                items={[
                  { label: "Edit", icon: Pencil, onClick: () => onEdit(record) },
                  ...(record.current
                    ? [{ label: "Checked today", icon: CheckCheck, onClick: () => onVerify(record) }]
                    : []),
                  { label: "Delete", icon: Trash2, onClick: () => onDelete(record), variant: "destructive" as const },
                ]}
              />
            </CapAlignedControls>
          </li>
        ))}
      </ol>
    </details>
  );
}

function ObjectItem({
  object,
  setDialog,
  onVerify,
}: {
  object: ObjectView;
  setDialog: (state: DialogState) => void;
  onVerify: (object: ObjectView, record: HistoryView) => void;
}) {
  const away = object.ownerVenue && object.currentVenueId && object.currentVenueId !== object.ownerVenue.id;
  return (
    <li
      className={`rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5 ${
        object.disposed ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="type-item-title">{object.name}</p>
          {object.facts && <Line>{object.facts}</Line>}
          {object.reproduces && <Line>{object.reproduces}</Line>}
          <Line>
            <span className="text-fg-secondary">Owner: </span>
            <span className="text-fg-primary">{object.owner}</span>
          </Line>
          {object.holding && <Line>{object.holding}</Line>}
          {object.kind !== "reproduction" && (
            <Line>
              <span className="text-fg-secondary">Now: </span>
              {object.now ? (
                <>
                  <span className="text-fg-primary">{object.now.place}</span>
                  {[object.now.custody, object.now.since].filter(Boolean).map((part) => ` · ${part}`)}
                  {" · "}
                  <span className={object.now.stale ? "text-accent-gold" : undefined}>
                    {object.now.checked}
                    {object.now.stale && ", check again"}
                  </span>
                  {object.now.source && ` · Source: ${object.now.source}`}
                </>
              ) : (
                <span>Not recorded</span>
              )}
            </Line>
          )}
          {object.notes && <p className="mt-0.5 text-xs text-fg-secondary">{object.notes}</p>}
        </div>
        <CapAlignedControls height={32} className="type-item-title">
          <EntityActionMenu
            items={[
              { label: "Edit", icon: Pencil, onClick: () => setDialog({ kind: "edit", object }) },
              { label: "Record a move", icon: MapPin, onClick: () => setDialog({ kind: "where", object, mode: "move" }) },
              { label: "Record a loan", icon: ArrowLeftRight, onClick: () => setDialog({ kind: "where", object, mode: "loan" }) },
              ...(away
                ? [{ label: "Record its return", icon: Undo2, onClick: () => setDialog({ kind: "where", object, mode: "return" as const }) }]
                : []),
              { label: "Add to its history", icon: History, onClick: () => setDialog({ kind: "where", object, mode: "history" }) },
              { label: "Delete", icon: Trash2, onClick: () => setDialog({ kind: "delete", object }), variant: "destructive" },
            ]}
          />
        </CapAlignedControls>
      </div>
      <HistoryList
        object={object}
        onEdit={(record) => setDialog({ kind: "where", object, mode: "edit", record })}
        onVerify={(record) => onVerify(object, record)}
        onDelete={(record) => setDialog({ kind: "delete-where", object, record })}
      />
    </li>
  );
}

/**
 * The physical objects of a painting: the original and any versions, each
 * with its owner, where it is now and its location history; then the
 * reproductions, which never stand in for the original. A curated painting
 * needs none of them.
 */
export function ArtObjectsSection({
  painting,
  objects,
  locations,
  sources,
}: {
  painting: { id: string; title: string };
  objects: ObjectView[];
  locations: StorageLocation[];
  sources: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const close = () => setDialog(null);
  const originals = objects.filter((o) => o.kind !== "reproduction");
  const reproductions = objects.filter((o) => o.kind === "reproduction");
  const reproducible: ReproducibleObject[] = originals.map((o) => ({ id: o.id, label: o.name }));
  const target = dialog && "object" in dialog ? dialog.object : null;

  async function verify(object: ObjectView, record: HistoryView) {
    try {
      await verifyWhereabouts(record.id, object.historyFingerprint);
      toast.success("Marked as checked today");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the check");
    }
  }

  const list = (items: ObjectView[]) => (
    <ul className="space-y-2">
      {items.map((object) => (
        <ObjectItem key={object.id} object={object} setDialog={setDialog} onVerify={verify} />
      ))}
    </ul>
  );

  return (
    <>
      <section className="mb-10" aria-labelledby="painting-objects">
        <SectionHeading
          id="painting-objects"
          title={originals.length > 1 ? "Original and versions" : "Original"}
          count={originals.length > 1 ? originals.length : undefined}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDialog({ kind: "add", objectKind: originals.some((o) => o.kind === "original") ? "version" : "original" })
              }
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              {originals.some((o) => o.kind === "original") ? "Add version" : "Add original"}
            </Button>
          }
        />
        {originals.length === 0 ? (
          <p className="text-sm text-fg-secondary">
            Where the original is, and who owns it, is not recorded yet.
          </p>
        ) : (
          list(originals)
        )}
      </section>

      <section className="mb-10" aria-labelledby="painting-reproductions">
        <SectionHeading
          id="painting-reproductions"
          title="Reproductions"
          count={reproductions.length || undefined}
          action={
            <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "add", objectKind: "reproduction" })}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Add reproduction
            </Button>
          }
        />
        {reproductions.length === 0 ? (
          <p className="text-sm text-fg-secondary">No print, copy or poster recorded</p>
        ) : (
          list(reproductions)
        )}
      </section>

      <ArtObjectDialog
        open={dialog?.kind === "add" || dialog?.kind === "edit"}
        onClose={close}
        paintingId={painting.id}
        paintingTitle={painting.title}
        object={dialog?.kind === "edit" ? dialog.object.editable : undefined}
        initialKind={dialog?.kind === "add" ? dialog.objectKind : undefined}
        originals={reproducible}
        locations={locations}
      />
      {dialog?.kind === "where" && (
        <WhereaboutsDialog
          open
          onClose={close}
          objectId={dialog.object.id}
          objectName={`${painting.title}: ${dialog.object.name}`}
          fingerprint={dialog.object.historyFingerprint}
          mode={dialog.mode}
          record={dialog.record?.editable}
          ownerVenue={dialog.object.ownerVenue}
          hasCurrent={!!dialog.object.now}
          sources={sources}
        />
      )}
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        title="Delete object"
        name={target ? `${painting.title}: ${target.name}` : ""}
        description="The object and its location history are deleted. The painting stays. To keep the record of an object you no longer own, mark it disposed instead."
        onConfirm={async () => {
          if (!target) return;
          try {
            const { cleanupPending } = await deleteArtObject(target.id);
            toast.success(cleanupPending ? "Object deleted; some image files could not be removed yet" : "Object deleted");
            close();
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the object");
          }
        }}
      />
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete-where"}
        onClose={close}
        title="Delete location"
        name={dialog?.kind === "delete-where" ? `${dialog.record.place}, ${dialog.record.period}` : ""}
        description="This removes the record from the location history. A move that closed the previous location does not reopen it."
        onConfirm={async () => {
          if (dialog?.kind !== "delete-where") return;
          try {
            await deleteWhereabouts(dialog.record.id, dialog.object.historyFingerprint);
            toast.success("Location deleted");
            close();
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the location");
          }
        }}
      />
    </>
  );
}
