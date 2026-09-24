"use client";

import { useState, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TaxonomyColorPicker } from "./taxonomy-color-picker";

interface CreateFamilyDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreateFamilyDialog({
  open,
  onClose,
  onCreated,
}: CreateFamilyDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entityLevel, setEntityLevel] = useState<"work" | "edition">("work");
  const [hierarchical, setHierarchical] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setEntityLevel("work");
    setHierarchical(false);
    setColor(null);
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

      const slug = slugify(trimmedName);
      if (!slug) {
        setError("Name must produce a valid slug");
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const { createTaxonomyFamily } = await import(
          "@/lib/actions/taxonomy-families"
        );
        await createTaxonomyFamily({
          name: trimmedName,
          slug,
          description: description.trim() || null,
          entityLevel,
          hierarchical,
          color,
        });
        toast.success(`Created family "${trimmedName}"`);
        resetForm();
        onCreated();
        onClose();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create family";
        setError(message);
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [name, description, entityLevel, hierarchical, color, resetForm, onCreated, onClose],
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="New Taxonomy Family"
      description="Create a custom taxonomy group to categorize your works or editions."
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
          placeholder="e.g. Reading Mood, Collection Series"
          error={error && !name.trim() ? "Name is required" : undefined}
        />

        {/* Slug preview */}
        {name.trim() && (
          <p className="font-mono text-xs text-fg-muted">
            Slug: {slugify(name.trim()) || "(invalid)"}
          </p>
        )}

        {/* Description */}
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description of this taxonomy"
          rows={3}
        />

        {/* Entity level: radio buttons */}
        <fieldset className="space-y-1.5">
          <legend className="block text-xs font-medium text-fg-secondary">
            Entity level
          </legend>
          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="entityLevel"
                value="work"
                checked={entityLevel === "work"}
                onChange={() => setEntityLevel("work")}
                className="h-3.5 w-3.5 border-glass-border bg-bg-primary text-accent-rose accent-accent-rose focus:ring-accent-rose"
              />
              <span className="text-sm text-fg-secondary">Work</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="entityLevel"
                value="edition"
                checked={entityLevel === "edition"}
                onChange={() => setEntityLevel("edition")}
                className="h-3.5 w-3.5 border-glass-border bg-bg-primary text-accent-rose accent-accent-rose focus:ring-accent-rose"
              />
              <span className="text-sm text-fg-secondary">Edition</span>
            </label>
          </div>
          <p className="text-[11px] text-fg-muted">
            Determines whether items in this family are linked to works or
            editions.
          </p>
        </fieldset>

        {/* Hierarchical toggle */}
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={hierarchical}
              onChange={(e) => setHierarchical(e.target.checked)}
              className="h-3.5 w-3.5 rounded-sm border-glass-border bg-bg-primary text-accent-rose accent-accent-rose focus:ring-accent-rose"
            />
            <span className="text-xs font-medium text-fg-secondary">
              Hierarchical
            </span>
          </label>
          <p className="pl-5.5 text-[11px] text-fg-muted">
            Enable parent-child nesting for items in this family.
          </p>
        </div>

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
            {submitting ? "Creating..." : "Create Family"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
