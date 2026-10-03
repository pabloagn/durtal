"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  deleteTaxonomyFamily,
  getTaxonomyFamilyUsage,
} from "@/lib/actions/taxonomy-families";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { taxonomyScopeLabel } from "@/lib/catalogue/taxonomies";

type Usage = NonNullable<Awaited<ReturnType<typeof getTaxonomyFamilyUsage>>>;

interface DeleteFamilyDialogProps {
  family: { id: string; name: string };
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Mounted only while open. A family that records use cannot be deleted; the
 * dialog says where it is used before offering anything.
 */
export function DeleteFamilyDialog({
  family,
  onClose,
  onDeleted,
}: DeleteFamilyDialogProps) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let live = true;
    getTaxonomyFamilyUsage(family.id)
      .then((result) => live && setUsage(result))
      .catch(() => live && setError("Could not read how this family is used"));
    return () => {
      live = false;
    };
  }, [family.id]);

  const enabled = new Set<string>(getEnabledWorkKinds());
  const used = (usage?.scopes ?? []).filter((scope) => scope.inUse);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteTaxonomyFamily(family.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete family");
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${family.name}`}
      className="max-w-md"
      expandable={false}
    >
      {!usage && !error ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <div className="space-y-4">
          {usage && usage.deletable && (
            <p className="text-sm text-fg-secondary">
              {usage.itemCount === 0
                ? "This family has no items. It will be removed."
                : `This family and its ${usage.itemCount} item${usage.itemCount === 1 ? "" : "s"} will be removed. No record uses them.`}
            </p>
          )}
          {usage && !usage.deletable && (
            <div className="space-y-2 text-sm text-fg-secondary">
              <p>This family cannot be deleted yet.</p>
              {used.length > 0 && (
                <p>
                  Records in{" "}
                  {used
                    .map((scope) =>
                      enabled.has(scope.kind)
                        ? taxonomyScopeLabel(scope.kind, scope.level)
                        : "a collection that is not open yet",
                    )
                    .join(", ")}{" "}
                  use its items. Remove or reassign those classifications
                  first; merging items keeps them.
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-accent-red">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {usage?.deletable ? "Cancel" : "Close"}
            </Button>
            {usage?.deletable && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? "Deleting..." : "Delete family"}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
