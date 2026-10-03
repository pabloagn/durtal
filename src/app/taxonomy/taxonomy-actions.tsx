"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ListOrdered, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CapAligned } from "@/components/shared/cap-aligned";
import { Dialog } from "@/components/ui/dialog";
import { CreateFamilyDialog } from "@/components/taxonomy/create-family-dialog";
import { reorderFamilies } from "@/lib/actions/taxonomy-families";

interface FamilyRef {
  id: string;
  name: string;
}

/** New family and family order, for the taxonomy directory header. */
export function TaxonomyActions({ families }: { families: FamilyRef[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<"create" | "reorder" | null>(null);
  return (
    <>
      {families.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          onClick={() => setOpen("reorder")}
        >
          <ListOrdered className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
          Reorder
        </Button>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0 whitespace-nowrap"
        onClick={() => setOpen("create")}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
        New family
      </Button>
      {open === "create" && (
        <CreateFamilyDialog
          open
          onClose={() => setOpen(null)}
          onCreated={(slug) => {
            setOpen(null);
            router.push(`/taxonomy/${slug}`);
            router.refresh();
          }}
        />
      )}
      {open === "reorder" && (
        <ReorderFamiliesDialog
          families={families}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            toast.success("Family order saved");
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ReorderFamiliesDialog({
  families,
  onClose,
  onSaved,
}: {
  families: FamilyRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [order, setOrder] = useState(families);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const move = (index: number, by: -1 | 1) =>
    setOrder((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await reorderFamilies(order.map((family) => family.id));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the order");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reorder families"
      description="The taxonomy directory and every classification editor use this order."
      className="max-w-md"
      expandable={false}
    >
      <ol className="max-h-[60vh] space-y-1 overflow-y-auto" aria-label="Family order">
        {order.map((family, index) => (
          <li
            key={family.id}
            className="flex items-start gap-1 rounded-sm border border-glass-border py-1 pl-3 pr-1 text-sm leading-7"
          >
            <span className="min-w-0 flex-1 truncate text-fg-primary">
              {family.name}
            </span>
            <CapAligned height={28}>
              <span className="flex">
                <button
                  type="button"
                  aria-label={`Move ${family.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-rose disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${family.name} down`}
                  disabled={index === order.length - 1}
                  onClick={() => move(index, 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-rose disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </span>
            </CapAligned>
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="mt-3 text-xs text-accent-red">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving..." : "Save order"}
        </Button>
      </div>
    </Dialog>
  );
}
