"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createRecommender,
  updateRecommender,
} from "@/lib/actions/recommenders";
import { parseWebsite } from "@/lib/utils/website";

interface Existing {
  id: string;
  name: string;
  url: string | null;
}

/**
 * Add or edit a recommender (name and website). Without `recommender` it
 * renders its own "Add Recommender" button; with it, it is controlled.
 */
export function RecommenderFormDialog({
  recommender,
  open: controlledOpen,
  onClose,
}: {
  recommender?: Existing;
  open?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const isEdit = !!recommender;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [name, setName] = useState(recommender?.name ?? "");
  const [url, setUrl] = useState(recommender?.url ?? "");
  const [urlTouched, setUrlTouched] = useState(false);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(recommender?.name ?? "");
    setUrl(recommender?.url ?? "");
    setUrlTouched(false);
    // The modal focuses its first button when it opens; start in Name instead.
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, recommender]);

  function close() {
    if (pending) return;
    if (controlledOpen === undefined) setInternalOpen(false);
    onClose?.();
  }

  const website = parseWebsite(url);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (!website.ok) {
      setUrlTouched(true);
      toast.error(website.error);
      return;
    }
    startTransition(async () => {
      try {
        const input = { name, url: website.value };
        const result = isEdit
          ? await updateRecommender(recommender.id, input)
          : await createRecommender(input);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(
          isEdit ? "Recommender updated" : `${result.recommender.name} added`,
        );
        close();
        if (isEdit) router.refresh();
        else router.push(`/recommenders/${result.recommender.id}`);
      } catch {
        toast.error("Could not save the recommender. Try again.");
      }
    });
  }

  return (
    <>
      {!isEdit && controlledOpen === undefined && (
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => setInternalOpen(true)}
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add Recommender
        </Button>
      )}
      <Dialog
        open={open}
        onClose={close}
        title={isEdit ? "Edit recommender" : "Add recommender"}
        className="max-w-md"
        expandable={false}
      >
        {/* Our own website check adds https:// — the browser's URL check would block "youtube.com/@…" */}
        <form onSubmit={submit} noValidate className="space-y-4">
          <Input
            ref={nameRef}
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Life on Books"
            disabled={pending}
            required
          />
          <Input
            label="Website"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setUrlTouched(true)}
            placeholder="https://www.youtube.com/@…"
            disabled={pending}
            error={urlTouched && !website.ok ? website.error : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !name.trim()}
            >
              {pending ? "Saving…" : isEdit ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
