"use client";
import { useRef, useState } from "react";
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
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import {
  updateCollection,
  deleteCollection,
  moveCollectionMember,
  removeEditionFromCollection,
  removeWorksFromCollection,
} from "@/lib/actions/collections";
import { AddCollectionBooksDialog } from "./add-books-dialog";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { collectionDeletedMessage } from "@/lib/collections/counts";
import type { WorkKind } from "@/lib/catalogue/kinds";

type Collection = {
  id: string;
  name: string;
  description: string | null;
};
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
  const router = useRouter();
  const params = useSearchParams();
  const [add, setAdd] = useState(initialAdd),
    [edit, setEdit] = useState(false),
    [artwork, setArtwork] = useState(false),
    [deleting, setDeleting] = useState(false),
    [name, setName] = useState(collection.name),
    [description, setDescription] = useState(collection.description ?? ""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  function closeAdd() {
    setAdd(false);
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
    } catch {
      toast.error("Could not update the collection");
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
      const result = await deleteCollection(collection.id);
      if (result.cleanupPending)
        toast.warning("Collection deleted; some artwork still needs cleanup.");
      else toast.success(collectionDeletedMessage(kinds));
      router.push("/collections");
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Could not delete the collection");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setAdd(true)}>
          <Plus size={14} strokeWidth={1.5} />
          Add
        </Button>
        <Button
          onClick={() => {
            setName(collection.name);
            setDescription(collection.description ?? "");
            setEdit(true);
          }}
        >
          <Pencil size={14} strokeWidth={1.5} />
          Edit
        </Button>
        <Button onClick={() => setArtwork(true)}>
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
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => setEdit(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "Saving…" : "Save"}
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
          <Button disabled={busy} onClick={() => setDeleting(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={remove}>
            {busy ? "Deleting…" : "Delete collection"}
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
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function act(direction?: -1 | 1) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (direction)
        await moveCollectionMember(collectionId, member, direction);
      else {
        if (member.kind === "edition")
          await removeEditionFromCollection(collectionId, member.id);
        else await removeWorksFromCollection(collectionId, [member.id]);
        toast.success("Removed from collection. Kept in your library.");
        triggerActivityRefresh();
      }
      router.refresh();
    } catch {
      toast.error("Could not update collection");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="ghost"
        data-tooltip="Move earlier"
        aria-label={`Move ${title} earlier`}
        disabled={busy || first}
        onClick={() => act(-1)}
      >
        <ArrowUp size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-tooltip="Move later"
        aria-label={`Move ${title} later`}
        disabled={busy || last}
        onClick={() => act(1)}
      >
        <ArrowDown size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-tooltip="Remove from collection"
        aria-label={`Remove ${title} from collection`}
        disabled={busy}
        onClick={() => act()}
      >
        <X size={14} />
      </Button>
    </div>
  );
}
