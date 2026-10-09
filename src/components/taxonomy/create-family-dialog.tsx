"use client";

import { useState, type FormEvent } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createTaxonomyFamily } from "@/lib/actions/taxonomy-families";
import { FamilyForm, type FamilyFormValue } from "./family-form";

interface CreateFamilyDialogProps {
  open: boolean;
  onClose: () => void;
  /** Receives the new family's URL slug. */
  onCreated: (slug: string) => void;
}

const EMPTY: FamilyFormValue = {
  name: "",
  description: "",
  color: null,
  hierarchical: false,
  scopes: [{ kind: "book", level: "work" }],
};

/** Mounted only while open, so every visit starts from an empty form. */
export function CreateFamilyDialog({
  open,
  onClose,
  onCreated,
}: CreateFamilyDialogProps) {
  const [value, setValue] = useState<FamilyFormValue>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.name.trim()) return setError("Name is required");
    if (!value.scopes.length)
      return setError("Choose at least one place this family applies");
    setSubmitting(true);
    setError(null);
    try {
      const family = await createTaxonomyFamily({
        name: value.name,
        description: value.description.trim() || null,
        color: value.color,
        hierarchical: value.hierarchical,
        scopes: value.scopes,
      });
      onCreated(family.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create family");
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New taxonomy family"
      className="max-w-lg"
      expandable={false}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FamilyForm value={value} onChange={setValue} />
        {error && (
          <p role="alert" className="text-xs text-accent-red-text">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={submitting || !value.name.trim() || !value.scopes.length}
          >
            {submitting ? "Creating..." : "Create family"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
