"use client";

import { RequiredNameHint } from "@/components/shared/required-name-hint";

import { NameDuplicateNotice } from "@/components/shared/name-duplicate-notice";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCollection } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";
import { shortcutProps } from "@/lib/shortcuts/shortcuts";

/**
 * Add collection. With `open` and `onOpenChange` the caller controls it (the
 * A menu); otherwise it shows its own "Add collection" button.
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
    } catch (error) {
      toast.error(refusalMessage(error, "Could not create the collection. Your details are still here."));
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
          variant="secondary" size="sm"
          data-tooltip="Add collection"
          {...shortcutProps("a then c")}
        >
          <Plus size={14} strokeWidth={1.5} />
          Add collection
        </Button>
      )}
      <Dialog
        draft
        open={open}
        onClose={() => {
          if (!busy.current) setOpen(false);
        }}
        title="Add collection"
        className="max-w-md"
        expandable={false}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="min-w-0 space-y-2"><Input
            label="Name"
            appearance="open"
            className="font-medium text-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Strange tales"
            maxLength={160}
            required
            autoFocus
            // Read-only, not disabled, while it saves: Enter here is the usual
            // way to create, and a disabled field drops the focus (SLN-920)
            readOnly={saving}
          /><NameDuplicateNotice kind="collection" name={name} /></div>
          <details>
            <summary className="cursor-pointer text-xs text-fg-secondary pointer-coarse:py-3">
              Add a description
            </summary>
            <Textarea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={3}
              readOnly={saving}
            />
          </details>
          <div className="flex justify-end gap-2">
        <RequiredNameHint value={name} message="Give the collection a name" />
            <Button data-dismiss=""
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
              disabled={!name.trim()}
              busy={saving}
            >
              Add
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
