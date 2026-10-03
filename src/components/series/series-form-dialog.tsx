"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TitleInput } from "@/components/shared/title-input";
import { Textarea } from "@/components/ui/textarea";
import { createSeries, updateSeries } from "@/lib/actions/series";

interface Existing {
  id: string;
  title: string;
  originalTitle: string | null;
  description: string | null;
  totalVolumes: number | null;
  isComplete: boolean;
}

/**
 * Add or edit a series. Without `series` it renders its own "Add Series"
 * button; with it, it is controlled by the page's action menu.
 */
export function SeriesFormDialog({
  series,
  open: controlledOpen,
  onClose,
}: {
  series?: Existing;
  open?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const isEdit = !!series;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [title, setTitle] = useState("");
  const [originalTitle, setOriginalTitle] = useState("");
  const [description, setDescription] = useState("");
  const [totalVolumes, setTotalVolumes] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(series?.title ?? "");
    setOriginalTitle(series?.originalTitle ?? "");
    setDescription(series?.description ?? "");
    setTotalVolumes(series?.totalVolumes ? String(series.totalVolumes) : "");
    setIsComplete(series?.isComplete ?? false);
    // The modal focuses its first button when it opens; start in Title instead.
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, series]);

  function close() {
    if (pending) return;
    if (controlledOpen === undefined) setInternalOpen(false);
    onClose?.();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    const volumes = totalVolumes.trim() ? Number(totalVolumes) : null;
    if (
      volumes !== null &&
      (!Number.isInteger(volumes) || volumes < 1 || volumes > 999)
    ) {
      toast.error("Total volumes must be a whole number from 1 to 999");
      return;
    }
    startTransition(async () => {
      try {
        const input = {
          title,
          originalTitle,
          description,
          totalVolumes: volumes,
          isComplete,
        };
        const result = isEdit
          ? await updateSeries(series.id, input)
          : await createSeries(input);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(
          isEdit ? "Series updated" : `${result.value.title} added`,
        );
        close();
        if (isEdit) router.refresh();
        else router.push(`/series/${result.value.id}?add=1`);
      } catch {
        toast.error("Could not save the series. Try again.");
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
          Add Series
        </Button>
      )}
      <Dialog
        open={open}
        onClose={close}
        title={isEdit ? "Edit series" : "Add series"}
        className="max-w-lg"
        expandable={false}
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          <TitleInput
            ref={titleRef}
            label="Title"
            value={title}
            onValueChange={setTitle}
            maxLength={300}
            placeholder="e.g. In Search of Lost Time"
            disabled={pending}
            required
          />
          <TitleInput
            label="Original title"
            value={originalTitle}
            onValueChange={setOriginalTitle}
            maxLength={300}
            placeholder="e.g. À la recherche du temps perdu"
            disabled={pending}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={5000}
            disabled={pending}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Total volumes"
              type="number"
              min={1}
              max={999}
              value={totalVolumes}
              onChange={(e) => setTotalVolumes(e.target.value)}
              placeholder="Unknown"
              disabled={pending}
            />
            <label className="flex items-end gap-2 pb-2 text-sm text-fg-secondary">
              <input
                type="checkbox"
                checked={isComplete}
                onChange={(e) => setIsComplete(e.target.checked)}
                disabled={pending}
                className="h-4 w-4 rounded-sm border-glass-border accent-accent-rose"
              />
              Series is complete
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !title.trim()}
            >
              {pending ? "Saving…" : isEdit ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
