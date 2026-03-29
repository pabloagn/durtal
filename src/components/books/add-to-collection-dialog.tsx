"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getCollections,
  createCollection,
  addEditionToCollection,
  removeEditionFromCollection,
  getEditionCollections,
} from "@/lib/actions/collections";
import { toast } from "sonner";

interface AddToCollectionDialogProps {
  open: boolean;
  onClose: () => void;
  editionId: string;
  title: string;
}

interface CollectionItem {
  id: string;
  name: string;
  description: string | null;
  editionCount: number;
}

export function AddToCollectionDialog({
  open,
  onClose,
  editionId,
  title,
}: AddToCollectionDialogProps) {
  const router = useRouter();
  const [allCollections, setAllCollections] = useState<CollectionItem[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cols, editionCols] = await Promise.all([
        getCollections(),
        getEditionCollections(editionId),
      ]);
      setAllCollections(
        cols.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          editionCount: c.collectionEditions.length,
        })),
      );
      setMemberIds(new Set(editionCols.map((c) => c.id)));
    } catch {
      toast.error("Failed to load collections");
    } finally {
      setLoading(false);
    }
  }, [editionId]);

  useEffect(() => {
    if (open) {
      fetchData();
      setFilter("");
      setNewName("");
    }
  }, [open, fetchData]);

  const filtered = allCollections.filter((c) =>
    c.name.toLowerCase().includes(filter.toLowerCase()),
  );

  // Sort: member collections first, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    const aMember = memberIds.has(a.id) ? 0 : 1;
    const bMember = memberIds.has(b.id) ? 0 : 1;
    if (aMember !== bMember) return aMember - bMember;
    return a.name.localeCompare(b.name);
  });

  async function handleToggle(collectionId: string) {
    const isMember = memberIds.has(collectionId);
    // Optimistic update
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (isMember) {
        next.delete(collectionId);
      } else {
        next.add(collectionId);
      }
      return next;
    });

    try {
      if (isMember) {
        await removeEditionFromCollection(collectionId, editionId);
        toast.success("Removed from collection");
      } else {
        await addEditionToCollection(collectionId, editionId);
        toast.success("Added to collection");
      }
      router.refresh();
    } catch {
      // Revert optimistic update
      setMemberIds((prev) => {
        const next = new Set(prev);
        if (isMember) {
          next.add(collectionId);
        } else {
          next.delete(collectionId);
        }
        return next;
      });
      toast.error(isMember ? "Failed to remove" : "Failed to add");
    }
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;

    setCreating(true);
    try {
      const created = await createCollection({ name: trimmed });
      await addEditionToCollection(created.id, editionId);
      setAllCollections((prev) => [
        ...prev,
        { id: created.id, name: created.name, description: null, editionCount: 1 },
      ]);
      setMemberIds((prev) => new Set([...prev, created.id]));
      setNewName("");
      toast.success(`Created "${trimmed}" and added edition`);
      router.refresh();
    } catch {
      toast.error("Failed to create collection");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to collection"
      description={title}
    >
      <div className="space-y-4">
        {/* Search filter */}
        <Input
          placeholder="Filter collections..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        {/* Collections list */}
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {loading ? (
            <p className="py-4 text-center text-sm text-fg-muted">Loading...</p>
          ) : sorted.length === 0 ? (
            <p className="py-4 text-center text-sm text-fg-muted">
              {filter ? "No matching collections" : "No collections yet"}
            </p>
          ) : (
            sorted.map((col) => {
              const isMember = memberIds.has(col.id);
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => handleToggle(col.id)}
                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors hover:bg-bg-tertiary/50"
                >
                  <div
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                      isMember
                        ? "border-accent-rose bg-accent-rose"
                        : "border-glass-border bg-bg-primary/80"
                    }`}
                  >
                    {isMember && (
                      <Check className="h-3 w-3 text-white" strokeWidth={2} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg-primary">{col.name}</p>
                    {col.description && (
                      <p className="truncate text-xs text-fg-muted">
                        {col.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-xs text-fg-muted">
                    {col.editionCount}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Create new collection */}
        <div className="border-t border-glass-border pt-4">
          <p className="mb-2 text-xs font-medium text-fg-secondary">
            New collection
          </p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Collection name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Create
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
