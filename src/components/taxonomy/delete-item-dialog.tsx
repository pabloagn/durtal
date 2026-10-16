"use client";

import { useState, type FormEvent } from "react";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { deleteTaxonomyItem } from "@/lib/actions/taxonomy-client";

interface Props {
  open: boolean;
  onClose: () => void;
  item: { id: string; name: string; entityCount: number; childCount?: number };
  familySlug: string;
  availableReassignTargets: { id: string; name: string }[];
  onDeleted: () => void;
}
export function DeleteItemDialog({ open, onClose, item, familySlug, availableReassignTargets, onDeleted }: Props) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const children = item.childCount ?? 0;
  const needsTarget = item.entityCount > 0;
  const blocked = children > 0 || (needsTarget && !availableReassignTargets.some(t => t.id === target));
  const close = () => { if (!busy) { setTarget(""); setError(null); onClose(); } };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked || busy) return;
    setBusy(true); setError(null);
    try {
      await deleteTaxonomyItem(familySlug, item.id, needsTarget ? target : undefined);
      toast.success(`Deleted "${item.name}"`);
      onClose(); onDeleted();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete this item";
      setError(message); toast.error(message);
    } finally { setBusy(false); }
  }
  return <Dialog open={open} onClose={close} title={`Delete ${item.name}`} className="max-w-lg" expandable={false}>
    <form onSubmit={submit} className="space-y-4">
      {children > 0 ? <p className="text-sm text-fg-secondary">This item has {children} child {children === 1 ? "item" : "items"}. Move the children first, then delete it.</p>
        : needsTarget ? <>
          <p className="text-sm text-fg-secondary">This item has {item.entityCount} catalogue {item.entityCount === 1 ? "link" : "links"}. Reassign them to another item before deleting it.</p>
          {availableReassignTargets.length ? <Select label="Reassign links to" placeholder="Choose another item" value={target} options={availableReassignTargets.map(t => ({ value: t.id, label: t.name }))} onChange={e => { setTarget(e.target.value); setError(null); }} disabled={busy} />
            : <p className="text-xs text-fg-secondary">There is no sibling item to receive these links. Add one or move this item first.</p>}
        </> : <p className="text-sm text-fg-secondary">This item has no catalogue links or children.</p>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      <p className="text-xs text-fg-secondary">This action cannot be undone.</p>
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button data-dismiss="" type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="danger" size="sm" busy={busy} disabled={blocked}>Delete</Button>
      </div>
    </form>
  </Dialog>;
}
