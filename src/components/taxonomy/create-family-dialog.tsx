"use client";

import { useId, useState, type FormEvent } from "react";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createTaxonomyFamily } from "@/lib/actions/taxonomy-client";
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
  // The footer sits outside the form, under the dialog's scrolling body
  const formId = useId();
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
      draft
      open={open}
      onClose={onClose}
      title="New taxonomy family"
      className="max-w-lg"
      expandable={false}
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <FamilyForm value={value} onChange={setValue} />
        {/* Under the dialog's body and always in view, with the reason a save
            failed over the buttons (SLN-943) */}
        <DialogFooter>
          {error && (
            <p role="alert" className="basis-full text-xs text-accent-red-text">
              {error}
            </p>
          )}
          <Button data-dismiss="" type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            size="sm"
            disabled={!value.name.trim() || !value.scopes.length}
            busy={submitting}
          >
            Create family
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
