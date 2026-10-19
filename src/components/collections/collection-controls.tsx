"use client";
import { useSaveReason } from "@/components/shared/save-reason";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  ArrowDown,
  X,
  Plus,
  Pencil,
  Trash2,
  ImageIcon,
} from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import { useEditActions } from "@/components/shortcuts/shortcuts-provider";
import { EDIT_KEYS, editTooltipKeys, shortcutProps } from "@/lib/shortcuts/shortcuts";
import { AddCollectionBooksDialog } from "./add-books-dialog";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { collectionDeletedMessage } from "@/lib/collections/counts";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { updateCollection, deleteCollectionFromPage, moveCollectionMember, removeEditionFromCollection, removeWorksFromCollection } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

const ADD_EVENT = "durtal:collection-add";

/**
 * The empty collection's own Add button: it opens the same dialog as the
 * header's Add, at once and with no round trip
 */
export function AddToCollectionButton() {
  return (
    <Button
      variant="secondary"
      onClick={() => window.dispatchEvent(new CustomEvent(ADD_EVENT))}
      data-focus-empty="collection"
    >
      <Plus size={14} strokeWidth={1.5} />
      Add to the collection
    </Button>
  );
}

type Collection = {
  id: string;
  name: string;
  description: string | null;
};

/** A labelled header button with no icon in a narrow row */
const NARROW_NO_ICON = "@max-[19rem]:[&>svg]:hidden";

export function CollectionControls({
  collection,
  editionIds,
  workIds = [],
  kinds = [],
  initialAdd = false,
}: {
  collection: Collection;
  editionIds: string[];
  /** Whole works in the collection */
  workIds?: string[];
  /** What it holds, one kind per work (a book once), for the delete message */
  kinds?: WorkKind[];
  initialAdd?: boolean;
}) {
  // Empty, the page's one Add is its empty state's (SLN-918)
  const empty = !editionIds.length && !workIds.length;
  const router = useRouter();
  const params = useSearchParams();
  const [add, setAdd] = useState(false),
    [edit, setEdit] = useState(false),
    [artwork, setArtwork] = useState(false),
    [deleting, setDeleting] = useState(false),
    [name, setName] = useState(collection.name),
    [description, setDescription] = useState(collection.description ?? ""),
    [busy, setBusy] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The empty state's button leaves once something is added, so the
    // dialog opens from the header's Add and hands focus back to it
    const onAdd = () => {
      // Empty, the header has no Add: the dialog opens from the empty state's
      (addButton.current ?? document.querySelector<HTMLElement>('[data-focus-empty="collection"]'))?.focus();
      setAdd(true);
    };
    window.addEventListener(ADD_EVENT, onAdd);
    // A new collection opens on its Add dialog: it opens from the header's
    // Add in the same way, so the focus comes back there after Add rather
    // than to the page body (SLN-920)
    if (initialAdd) onAdd();
    return () => window.removeEventListener(ADD_EVENT, onAdd);
    // Once, on arrival: initialAdd is the address it opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function openEdit() {
    setName(collection.name);
    setDescription(collection.description ?? "");
    setEdit(true);
  }
  // E then C or M: the same dialogs as the Edit and Artwork buttons (SLN-633)
  useEditActions([
    { key: EDIT_KEYS.collection, label: "Collection", icon: Pencil, run: openEdit },
    { key: EDIT_KEYS.media, label: "Artwork", icon: ImageIcon, run: () => setArtwork(true) },
  ]);
  const pending = useRef(false);
  // Books added to an empty collection: the empty state's Add, which opened
  // the dialog, leaves with it, so the focus goes to the header's Add that
  // takes its place, whether the page or the dialog goes first
  const focusAddIfLost = () => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) addButton.current?.focus();
  };
  const wasEmpty = useRef(empty);
  useEffect(() => {
    if (wasEmpty.current && !empty) focusAddIfLost();
    wasEmpty.current = empty;
  }, [empty]);
  function closeAdd() {
    setAdd(false);
    setTimeout(focusAddIfLost, 0);
    if (params.has("add")) {
      const next = new URLSearchParams(params.toString());
      next.delete("add");
      router.replace(
        `/collections/${collection.id}${next.size ? `?${next}` : ""}`,
        { scroll: false },
      );
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await updateCollection(collection.id, {
        name,
        description: description.trim() || null,
      });
      setEdit(false);
      router.refresh();
      toast.success("Collection updated");
    } catch (error) {
      toast.error(refusalMessage(error, "Could not update the collection"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      // On to the list in the action's own response (SLN-1330)
      const stayed = await deleteCollectionFromPage(collection.id);
      if (stayed?.cleanupPending) {
        toast.warning("Collection deleted; some artwork still needs cleanup.");
        router.push("/collections");
      } else toast.success(collectionDeletedMessage(kinds));
      triggerActivityRefresh();
    } catch (error) {
      toast.error(refusalMessage(error, "Could not delete the collection"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const nameReason = useSaveReason(!name.trim() && "Give the collection a name");
  return (
    <>
      {/* In a row too narrow for all four (300px on touch), the labelled
          buttons drop their icons, so Delete never wraps alone (SLN-879) */}
      <div className="@container">
      <div className="flex flex-wrap items-center gap-2">
        {!empty && (
          <Button ref={addButton} variant="secondary" onClick={() => setAdd(true)} className={NARROW_NO_ICON}>
            <Plus size={14} strokeWidth={1.5} />
            Add
          </Button>
        )}
        <Button
          className={NARROW_NO_ICON}
          data-tooltip="Edit collection"
          {...shortcutProps(editTooltipKeys(EDIT_KEYS.collection))}
          onClick={openEdit}
        >
          <Pencil size={14} strokeWidth={1.5} />
          Edit
        </Button>
        <Button
          className={NARROW_NO_ICON}
          data-tooltip="Edit artwork"
          {...shortcutProps(editTooltipKeys(EDIT_KEYS.media))}
          onClick={() => setArtwork(true)}
        >
          <ImageIcon size={14} strokeWidth={1.5} />
          Artwork
        </Button>
        <Button
          variant="ghost"
          aria-label="Delete collection"
          data-tooltip="Delete collection"
          onClick={() => setDeleting(true)}
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </Button>
      </div>
      </div>
      {add && (
        <AddCollectionBooksDialog
          open={add}
          onClose={closeAdd}
          collectionId={collection.id}
          existingIds={editionIds}
          existingWorkIds={workIds}
        />
      )}
      <Dialog
        draft
        open={edit}
        onClose={() => {
          if (!busy) setEdit(false);
        }}
        title="Edit collection"
        className="max-w-md"
        expandable={false}
      >
        <form onSubmit={save} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            disabled={busy}
            required
            autoFocus
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={5000}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {nameReason.hint}
            <Button data-dismiss=""
              type="button"
              disabled={busy}
              onClick={() => setEdit(false)}
            >
              Cancel
            </Button>
            <Button aria-describedby={nameReason.describedBy}
              type="submit"
              variant="primary"
              disabled={!name.trim()}
              busy={busy}
            >
              Save
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={deleting}
        onClose={() => {
          if (!busy) setDeleting(false);
        }}
        title="Delete collection"
        className="max-w-md"
        expandable={false}
      >
        <p className="mb-4 text-sm text-fg-secondary">
          Delete “{collection.name}” and its collection artwork? Every book,
          edition, copy and other work in it stays in your library.
        </p>
        <div className="flex justify-end gap-2">
          <Button data-dismiss="" disabled={busy} onClick={() => setDeleting(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} busy={busy}>
            Delete collection
          </Button>
        </div>
      </Dialog>
      <MediaManagerDialog
        open={artwork}
        onClose={() => setArtwork(false)}
        entityType="collection"
        entityId={collection.id}
        title={collection.name}
      />
    </>
  );
}

export function CollectionMemberControls({
  collectionId,
  member,
  title,
  first,
  last,
}: {
  collectionId: string;
  /** An edition, or a whole work (film, perfume, painting, book with no edition chosen) */
  member: { kind: "edition" | "work"; id: string };
  title: string;
  first: boolean;
  last: boolean;
}) {
  const router = useRouter();
  // The press that runs: busy, not disabled, so the focus stays on it until
  // its card goes (FocusKeeper); the others ignore presses meanwhile
  const [busy, setBusy] = useState<-1 | 1 | 0 | null>(null);
  const pending = useRef(false);
  // A move that lands can move the card's node, which blurs the button in it
  // (SLN-1028). Once the refresh is in, the focus goes back to the Move
  // pressed, or to the other Move when the card reached that end
  const [refreshing, startRefresh] = useTransition();
  const moved = useRef<-1 | 1 | null>(null);
  const earlier = useRef<HTMLButtonElement>(null);
  const later = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (refreshing || !moved.current) return;
    const atEnd = moved.current === -1 ? first : last;
    const pressed = moved.current === -1 ? earlier.current : later.current;
    const other = moved.current === -1 ? later.current : earlier.current;
    moved.current = null;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (lost || (atEnd && active === pressed)) (atEnd ? other : pressed)?.focus({ preventScroll: true });
  }, [refreshing, first, last]);
  async function act(direction?: -1 | 1) {
    if (pending.current) return;
    pending.current = true;
    setBusy(direction ?? 0);
    try {
      if (direction) {
        await moveCollectionMember(collectionId, member, direction);
        moved.current = direction;
        startRefresh(() => router.refresh());
        return;
      }
      if (member.kind === "edition")
        await removeEditionFromCollection(collectionId, member.id);
      else await removeWorksFromCollection(collectionId, [member.id]);
      toast.success("Removed from collection. Kept in your library.");
      triggerActivityRefresh();
      router.refresh();
    } catch (error) {
      toast.error(refusalMessage(error, "Could not update collection"));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  // Last in its card's foot, on the right even when it wraps to its own
  // line; the remove button's padding goes past the text's right edge
  return (
    <div className="-mr-2.5 ml-auto flex gap-1 pointer-coarse:-mr-3.5 pointer-coarse:gap-2">
      <Button
        size="sm"
        variant="ghost"
        data-tooltip="Move earlier"
        aria-label={`Move ${title} earlier`}
        ref={earlier}
        busy={busy === -1}
        // Held, not disabled, at the start: a disabled button drops the focus
        aria-disabled={first || busy === -1 || undefined}
        onClick={() => !first && act(-1)}
      >
        <ArrowUp size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-tooltip="Move later"
        aria-label={`Move ${title} later`}
        ref={later}
        busy={busy === 1}
        aria-disabled={last || busy === 1 || undefined}
        onClick={() => !last && act(1)}
      >
        <ArrowDown size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-tooltip="Remove from collection"
        aria-label={`Remove ${title} from collection`}
        busy={busy === 0}
        onClick={() => act()}
      >
        <X size={14} />
      </Button>
    </div>
  );
}
