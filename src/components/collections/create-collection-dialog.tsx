"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCollection } from "@/lib/actions/collections";

/**
 * New collection. With `open` and `onOpenChange` the caller controls it (the
 * A menu); otherwise it shows its own "New collection" button.
 */
export function CreateCollectionDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const router = useRouter();
  const [ownOpen, setOwnOpen] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [saving, setSaving] = useState(false);
  const requestId = useRef("");
  const busy = useRef(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) =>
    controlled ? onOpenChange?.(next) : setOwnOpen(next);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !name.trim()) return;
    // One id per opened form, so a retry never makes a second collection
    if (!requestId.current) requestId.current = crypto.randomUUID();
    busy.current = true;
    setSaving(true);
    try {
      const collection = await createCollection(
        { name, description: description.trim() || null },
        [],
        requestId.current,
      );
      setOpen(false);
      router.push(`/collections/${collection.id}?add=1`);
      router.refresh();
      toast.success("Collection created");
    } catch {
      toast.error(
        "Could not create the collection. Your details are still here.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      {!controlled && (
        <Button
          onClick={() => {
            setName("");
            setDescription("");
            requestId.current = crypto.randomUUID();
            setOpen(true);
          }}
          variant="primary"
          data-tooltip="New collection"
          data-tooltip-keys="a then c"
        >
          <Plus size={14} strokeWidth={1.5} />
          New collection
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => {
          if (!busy.current) setOpen(false);
        }}
        title="New collection"
        className="max-w-md"
        expandable={false}
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Strange tales"
            maxLength={160}
            required
            autoFocus
            disabled={saving}
          />
          <details>
            <summary className="cursor-pointer text-xs text-fg-secondary">
              Add a description
            </summary>
            <Textarea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={3}
              disabled={saving}
            />
          </details>
          <p className="text-xs text-fg-secondary">
            Add books and artwork after creating it.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !name.trim()}
            >
              {saving ? "Creating…" : "Create collection"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
