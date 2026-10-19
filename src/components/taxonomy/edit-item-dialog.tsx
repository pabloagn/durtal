"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { getTaxonomyItemDescription } from "@/lib/actions/taxonomy-browse";
import { TaxonomyColorPicker } from "./taxonomy-color-picker";
import { ParentPicker, type ParentChoice } from "./parent-picker";

export interface EditableItem {
  id: string;
  name: string;
  color: string | null;
  parentId?: string | null;
}

/**
 * Edit an item (name, colour, description where the family keeps one,
 * parent) or only move it (SLN-1158). Mounted only while open; a move
 * leaves out the item and everything under it, and the database refuses a
 * loop all the same.
 */
export function EditItemDialog({
  mode,
  item,
  familySlug,
  familyName,
  hierarchical,
  describable,
  choices,
  onClose,
  onSaved,
}: {
  mode: "edit" | "move";
  item: EditableItem;
  familySlug: string;
  familyName: string;
  hierarchical: boolean;
  describable: boolean;
  choices: ParentChoice[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const move = mode === "move";
  const [name, setName] = useState(item.name);
  const [color, setColor] = useState(item.color);
  const [parentId, setParentId] = useState(item.parentId ?? "");
  // undefined while the stored description loads
  const [description, setDescription] = useState<string | undefined>(
    move || !describable ? "" : undefined,
  );
  const [stored, setStored] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (move || !describable) return;
    let live = true;
    getTaxonomyItemDescription(familySlug, item.id)
      .then((text) => {
        if (!live) return;
        setStored(text ?? "");
        setDescription(text ?? "");
      })
      .catch(() => live && setError("Could not load the description. Close and try again."));
    return () => {
      live = false;
    };
  }, [move, describable, familySlug, item.id]);

  const trimmed = name.trim();
  const changes = {
    ...(!move && trimmed !== item.name ? { name: trimmed } : {}),
    ...(!move && color !== item.color ? { color } : {}),
    ...(!move && describable && description !== undefined && description.trim() !== stored.trim()
      ? { description: description.trim() || null }
      : {}),
    ...(hierarchical && parentId !== (item.parentId ?? "") ? { parentId: parentId || null } : {}),
  };
  const changed = Object.keys(changes).length > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || !changed || description === undefined) return;
    setSubmitting(true);
    setError(null);
    try {
      const { updateTaxonomyItem } = await import("@/lib/actions/taxonomy-client");
      await updateTaxonomyItem(familySlug, item.id, changes);
      toast.success(move ? `Moved "${item.name}"` : `Saved "${trimmed}"`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the item");
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      draft
      open
      onClose={onClose}
      title={move ? `Move ${item.name}` : `Edit ${item.name}`}
      className="max-w-lg"
      expandable={false}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!move && (
          <>
            <Input
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={!trimmed ? "Name is required" : undefined}
            />
            <div className="space-y-1.5">
              <span className="type-label block">Color</span>
              <div className="flex items-center gap-2">
                <TaxonomyColorPicker label={`Pick color for ${item.name}`} value={color} onChange={setColor} />
                <span className="font-mono text-xs text-fg-secondary">{color ?? "None"}</span>
              </div>
            </div>
            {describable && (
              <Textarea
                label="Description"
                value={description ?? ""}
                disabled={description === undefined}
                placeholder={description === undefined ? "Loading…" : "Optional description"}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            )}
          </>
        )}
        {hierarchical && (
          <ParentPicker
            familyName={familyName}
            choices={choices}
            value={parentId}
            onChange={setParentId}
            exclude={item.id}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-accent-red-text">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button data-dismiss="" type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!trimmed || !changed || description === undefined}
            busy={submitting}
          >
            {move ? "Move" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
