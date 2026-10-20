"use client";

import { useSaveReason } from "@/components/shared/save-reason";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getTaxonomyFamilyUsage } from "@/lib/actions/taxonomy-families";
import { updateTaxonomyFamily } from "@/lib/actions/taxonomy-client";
import {
  FamilyForm,
  scopeKey,
  type FamilyFormValue,
  type FamilyScope,
} from "./family-form";

export interface EditableFamily {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  hierarchical: boolean;
  applicability: FamilyScope[];
}

interface EditFamilyDialogProps {
  family: EditableFamily;
  /** Whether any item of the family has a parent. */
  nested: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Mounted only while open. Before anything is saved it shows which scopes
 * records use, so a change that would be refused is not offered.
 */
export function EditFamilyDialog({
  family,
  nested,
  onClose,
  onSaved,
}: EditFamilyDialogProps) {
  // The footer sits outside the form, under the dialog's scrolling body
  const formId = useId();
  const [value, setValue] = useState<FamilyFormValue>({
    name: family.name,
    description: family.description ?? "",
    color: family.color,
    hierarchical: family.hierarchical,
    scopes: family.applicability.map(({ kind, level }) => ({ kind, level })),
  });
  const [used, setUsed] = useState<Set<string> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getTaxonomyFamilyUsage(family.id)
      .then((usage) => {
        if (live)
          setUsed(
            new Set(
              (usage?.scopes ?? []).filter((s) => s.inUse).map(scopeKey),
            ),
          );
      })
      .catch(() => live && setError("Could not read how this family is used"));
    return () => {
      live = false;
    };
  }, [family.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.name.trim()) return setError("Name is required");
    if (!family.isSystem && !value.scopes.length)
      return setError("Choose at least one place this family applies");
    setSubmitting(true);
    setError(null);
    try {
      await updateTaxonomyFamily(family.id, {
        name: value.name,
        description: value.description.trim() || null,
        color: value.color,
        ...(family.isSystem
          ? {}
          : { hierarchical: value.hierarchical, scopes: value.scopes }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save family");
      setSubmitting(false);
    }
  }

  const nameReason = useSaveReason(!value.name.trim() && "Give the family a name");
  return (
    <Dialog
      draft
      open
      onClose={onClose}
      title={`Edit ${family.name}`}
      description="Renaming keeps the family's address."
      className="max-w-lg"
      expandable={false}
    >
      {used === null && !error ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <FamilyForm
            value={value}
            onChange={setValue}
            isSystem={family.isSystem}
            usedScopes={used ?? undefined}
            hierarchyLocked={nested}
          />
          {/* Under the dialog's body and always in view, with the reason a save
              failed over the buttons (SLN-1056) */}
          <DialogFooter>
            {error && (
              <p role="alert" className="basis-full text-xs text-accent-red-text">
                {error}
              </p>
            )}
            {nameReason.hint}
            <Button data-dismiss="" type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button aria-describedby={nameReason.describedBy}
              type="submit"
              form={formId}
              variant="primary"
              size="sm"
              disabled={!value.name.trim() || used === null}
              busy={submitting}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
