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
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import {
  updateCollection,
  deleteCollection,
  moveCollectionEdition,
  removeEditionFromCollection,
} from "@/lib/actions/collections";
import { AddCollectionBooksDialog } from "./add-books-dialog";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

type Collection = {
  id: string;
  name: string;
  description: string | null;
  posterS3Key: string | null;
  backgroundS3Key: string | null;
  coverS3Key: string | null;
};
export function CollectionControls({
  collection,
  editionIds,
  initialAdd = false,
}: {
  collection: Collection;
  editionIds: string[];
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
      else toast.success("Collection deleted. Books remain in your library.");
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
          Add books
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
          Delete “{collection.name}” and its collection artwork? All books,
          editions and copies stay in your library.
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
      {artwork && (
        <CollectionArtwork
          collection={collection}
          onClose={() => setArtwork(false)}
        />
      )}
    </>
  );
}

function CollectionArtwork({
  collection,
  onClose,
}: {
  collection: Collection;
  onClose: () => void;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState<string | null>(null);
  const busy = useRef(false);
  async function upload(type: "poster" | "background", file: File) {
    if (busy.current) return;
    if (
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
        file.type,
      ) ||
      file.size > 20 * 1024 * 1024
    ) {
      toast.error("Choose a JPG, PNG, WebP or GIF image up to 20 MB.");
      return;
    }
    busy.current = true;
    setUploading(type);
    try {
      const presign = await fetch("/api/media/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "presign",
          entityType: "collection",
          entityId: collection.id,
          filename: file.name,
          contentType: file.type,
        }),
      });
      if (!presign.ok) throw new Error("presign");
      const { url, bronzeKey, fileId } = await presign.json();
      const uploaded = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploaded.ok) throw new Error("upload");
      const processed = await fetch("/api/media/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process",
          entityType: "collection",
          entityId: collection.id,
          mediaType: type,
          fileId,
          bronzeKey,
          originalFilename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
      if (!processed.ok) throw new Error("process");
      router.refresh();
      toast.success("Collection artwork updated");
    } catch {
      toast.error(
        "Could not upload artwork. Your collection and books are saved.",
      );
    } finally {
      busy.current = false;
      setUploading(null);
    }
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!busy.current) onClose();
      }}
      title="Collection artwork"
      className="max-w-lg"
      expandable={false}
    >
      <div className="grid grid-cols-2 gap-4">
        {(["poster", "background"] as const).map((type) => {
          const key =
            type === "poster"
              ? (collection.posterS3Key ?? collection.coverS3Key)
              : collection.backgroundS3Key;
          return (
            <div key={type} className="space-y-3">
              <p className="text-sm capitalize">{type}</p>
              <div className="relative flex h-36 items-center justify-center rounded-sm border border-glass-border bg-bg-primary">
                {key ? (
                  <>
                    <img
                      src={`/api/s3/read?key=${encodeURIComponent(key)}`}
                      alt={`Collection ${type}`}
                      className="h-full w-full object-contain"
                    />
                    <ImageAdjustButton
                      source={`/api/s3/read?key=${encodeURIComponent(key)}`}
                      className="absolute bottom-2 right-2"
                    />
                  </>
                ) : (
                  <ImageIcon size={24} strokeWidth={1} />
                )}
              </div>
              <label className="block text-xs text-fg-secondary">
                {uploading === type
                  ? "Uploading…"
                  : key
                    ? "Replace image"
                    : "Choose image"}
                <input
                  aria-label={`Upload ${type}`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="mt-2 block w-full text-xs"
                  disabled={!!uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(type, file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <Button disabled={!!uploading} onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

export function CollectionMemberControls({
  collectionId,
  editionId,
  title,
  first,
  last,
}: {
  collectionId: string;
  editionId: string;
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
        await moveCollectionEdition(collectionId, editionId, direction);
      else {
        await removeEditionFromCollection(collectionId, editionId);
        toast.success("Removed from collection. Book kept in your library.");
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
        title="Move earlier"
        aria-label={`Move ${title} earlier`}
        disabled={busy || first}
        onClick={() => act(-1)}
      >
        <ArrowUp size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title="Move later"
        aria-label={`Move ${title} later`}
        disabled={busy || last}
        onClick={() => act(1)}
      >
        <ArrowDown size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title="Remove from collection"
        aria-label={`Remove ${title} from collection`}
        disabled={busy}
        onClick={() => act()}
      >
        <X size={14} />
      </Button>
    </div>
  );
}
