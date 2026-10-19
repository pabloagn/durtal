"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MultiSelectSection } from "@/components/shared/multi-select-section";
import { OptionsNotice } from "@/components/shared/options-notice";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { useEditOptions } from "@/hooks/use-edit-options";
import { TAXONOMY_GROUPS, withChosen, type EditOption, type TaxonomyGroup } from "@/lib/catalogue/edit-options";
import { updateWorkTaxonomy } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

/** The dialog's sections, in order, each with its field in the save */
const SECTIONS = [
  { group: "subjects", title: "Subjects", field: "subjectIds" },
  { group: "categories", title: "Categories", field: "categoryIds" },
  { group: "themes", title: "Themes", field: "themeIds" },
  { group: "literaryMovements", title: "Literary Movements", field: "literaryMovementIds" },
  { group: "artTypes", title: "Art Types", field: "artTypeIds" },
  { group: "artMovements", title: "Art Movements", field: "artMovementIds" },
  { group: "keywords", title: "Keywords", field: "keywordIds" },
  { group: "attributes", title: "Attributes", field: "attributeIds" },
] as const satisfies readonly { group: TaxonomyGroup; title: string; field: string }[];

type Selection = Record<TaxonomyGroup, string[]>;

interface WorkTaxonomyEditDialogProps {
  workId: string;
  /** The work's own classifications; the full lists load when the dialog opens (SLN-510) */
  chosen: Record<TaxonomyGroup, EditOption[]>;
  /** When provided, the dialog is externally controlled and no trigger button is rendered */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function WorkTaxonomyEditDialog({
  workId,
  chosen,
  open: controlledOpen,
  onOpenChange,
}: WorkTaxonomyEditDialogProps) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const [isPending, startTransition] = useTransition();
  const lists = useEditOptions(TAXONOMY_GROUPS, open);
  const current = (): Selection =>
    Object.fromEntries(TAXONOMY_GROUPS.map((g) => [g, chosen[g].map((o) => o.id)])) as Selection;
  const [selected, setSelected] = useState(current);

  // Every opening starts from the work as it is now (during render, as the
  // dialog turns open: no effect, no second render)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSelected(current());
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateWorkTaxonomy(
          workId,
          Object.fromEntries(SECTIONS.map((s) => [s.field, selected[s.group]])) as Record<(typeof SECTIONS)[number]["field"], string[]>,
        );
        toast.success("Taxonomy updated");
        setOpen(false);
        router.refresh();
        triggerActivityRefresh();
      } catch (error) {
        toast.error(refusalMessage(error, "Failed to update taxonomy"));
      }
    });
  }

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
        >
          <Tag className="h-3.5 w-3.5" strokeWidth={1.5} />
          Edit taxonomy
        </button>
      )}

      <Dialog
        draft
        open={open}
        onClose={() => setOpen(false)}
        title="Edit taxonomy"
        className="max-w-3xl"
      >
        <div className="space-y-5">
          {SECTIONS.map((s) => (
            <MultiSelectSection
              key={s.group}
              title={s.title}
              items={withChosen(lists.options[s.group], chosen[s.group])}
              selectedIds={selected[s.group]}
              onChange={(ids) => setSelected((prev) => ({ ...prev, [s.group]: ids }))}
              emptyText={lists.failed ? "Not loaded" : lists.loading ? "Loading…" : undefined}
            />
          ))}
        </div>

        <DialogFooter>
          <div className="mr-auto min-w-0">
            <OptionsNotice loading={lists.loading} failed={lists.failed} onRetry={lists.retry} />
          </div>
          <Button data-dismiss=""
            variant="secondary"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            busy={isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
