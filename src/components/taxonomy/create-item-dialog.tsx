"use client";

import { useSaveReason } from "@/components/shared/save-reason";
import { useState, useCallback, type FormEvent } from "react";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TaxonomyColorPicker } from "./taxonomy-color-picker";
import { ParentPicker, type ParentChoice } from "./parent-picker";
import { NameTwinNotice, useTaxonomyNameTwin } from "./name-twin-notice";

interface CreateItemDialogProps {
  open: boolean;
  onClose: () => void;
  familySlug: string;
  familyName: string;
  hierarchical: boolean;
  /** Whether the family's items keep a description (SLN-1158) */
  describable: boolean;
  existingItems: ParentChoice[];
  onCreated: (id: string) => void;
}

export function CreateItemDialog({
  open,
  onClose,
  familySlug,
  familyName,
  hierarchical,
  describable,
  existingItems,
  onCreated,
}: CreateItemDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [parentId, setParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sibling this name repeats, accents and case aside: the dialog names
  // it and offers it, and Create becomes Create anyway (SLN-1016, SLN-1159)
  const twin = useTaxonomyNameTwin(familySlug, name, { parentId: parentId || null }, open);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setColor(null);
    setParentId("");
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName) {
        setError("Name is required");
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        // Dynamic import to avoid circular dependency — action may not exist yet
        const { createTaxonomyItem } = await import(
          "@/lib/actions/taxonomy-client"
        );
        const created = await createTaxonomyItem(familySlug, {
          name: trimmedName,
          description: describable ? description.trim() || null : null,
          color,
          parentId: parentId || null,
          ...(twin?.saveAnyway ? { allowDuplicateName: true } : {}),
        });
        toast.success(`Created "${trimmedName}"`);
        resetForm();
        onCreated(created.id);
        onClose();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create item";
        setError(message);
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [name, description, describable, color, parentId, twin, familySlug, resetForm, onCreated, onClose],
  );

  const nameReason = useSaveReason(!name.trim() && "Give the item a name");
  return (
    <Dialog
      draft
      open={open}
      onClose={handleClose}
      title={`Add to ${familyName}`}
      className="max-w-lg"
      expandable={false}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter item name"
          error={error && !name.trim() ? "Name is required" : undefined}
        />
        {twin && <NameTwinNotice familySlug={familySlug} twin={twin} hierarchical={hierarchical} />}

        {/* Color */}
        <div className="space-y-1.5">
          <label className="type-label block">
            Color
          </label>
          <div className="flex items-center gap-2">
            <TaxonomyColorPicker value={color} onChange={setColor} />
            <span className="font-mono text-xs text-fg-secondary">
              {color ?? "None"}
            </span>
          </div>
        </div>

        {/* Description, where the family keeps one */}
        {describable && (
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
          />
        )}

        {/* Parent (only for hierarchical families) */}
        {hierarchical && existingItems.length > 0 && (
          <ParentPicker
            familyName={familyName}
            choices={existingItems}
            value={parentId}
            onChange={setParentId}
          />
        )}

        {/* Error */}
        {error && <p className="text-xs text-accent-red-text">{error}</p>}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {nameReason.hint}
          <Button data-dismiss=""
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button aria-describedby={nameReason.describedBy}
            type="submit"
            variant="primary"
            size="sm"
            disabled={!name.trim() || (!!twin && !twin.saveAnyway)}
            busy={submitting}
          >
            {twin?.saveAnyway ? "Create anyway" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
