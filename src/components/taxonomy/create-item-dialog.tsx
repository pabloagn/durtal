"use client";

import { useState, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TaxonomyColorPicker } from "./taxonomy-color-picker";

interface CreateItemDialogProps {
  open: boolean;
  onClose: () => void;
  familySlug: string;
  familyName: string;
  hierarchical: boolean;
  existingItems: { id: string; name: string }[];
  onCreated: () => void;
}

export function CreateItemDialog({
  open,
  onClose,
  familySlug,
  familyName,
  hierarchical,
  existingItems,
  onCreated,
}: CreateItemDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [parentId, setParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          "@/lib/actions/taxonomy-families"
        );
        await createTaxonomyItem(familySlug, {
          name: trimmedName,
          description: description.trim() || null,
          color,
          parentId: parentId || null,
        });
        toast.success(`Created "${trimmedName}"`);
        resetForm();
        onCreated();
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
    [name, description, color, parentId, familySlug, resetForm, onCreated, onClose],
  );

  const parentOptions = existingItems.map((item) => ({
    value: item.id,
    label: item.name,
  }));

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={`New ${familyName} Item`}
      description={`Add a new item to the ${familyName} taxonomy.`}
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

        {/* Color */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-fg-secondary">
            Color
          </label>
          <div className="flex items-center gap-2">
            <TaxonomyColorPicker value={color} onChange={setColor} />
            <span className="font-mono text-xs text-fg-muted">
              {color ?? "None"}
            </span>
          </div>
        </div>

        {/* Description */}
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={3}
        />

        {/* Parent (only for hierarchical families) */}
        {hierarchical && parentOptions.length > 0 && (
          <Select
            label="Parent"
            options={parentOptions}
            placeholder="None (root level)"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          />
        )}

        {/* Error */}
        {error && <p className="text-xs text-accent-red">{error}</p>}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
