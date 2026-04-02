"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MultiSelectSection } from "@/components/shared/multi-select-section";
import { updateWorkTaxonomy } from "@/lib/actions/taxonomy";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

interface WorkTaxonomyEditDialogProps {
  workId: string;
  currentSubjectIds: string[];
  currentCategoryIds: string[];
  currentThemeIds: string[];
  currentLiteraryMovementIds: string[];
  currentArtTypeIds: string[];
  currentArtMovementIds: string[];
  currentKeywordIds: string[];
  currentAttributeIds: string[];
  subjects: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  themes: { id: string; name: string }[];
  literaryMovements: { id: string; name: string }[];
  artTypes: { id: string; name: string }[];
  artMovements: { id: string; name: string }[];
  keywords: { id: string; name: string }[];
  attributes: { id: string; name: string }[];
  /** When provided, the dialog is externally controlled and no trigger button is rendered */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function WorkTaxonomyEditDialog({
  workId,
  currentSubjectIds,
  currentCategoryIds,
  currentThemeIds,
  currentLiteraryMovementIds,
  currentArtTypeIds,
  currentArtMovementIds,
  currentKeywordIds,
  currentAttributeIds,
  subjects,
  categories,
  themes,
  literaryMovements,
  artTypes,
  artMovements,
  keywords,
  attributes,
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

  const [subjectIds, setSubjectIds] = useState<string[]>(currentSubjectIds);
  const [categoryIds, setCategoryIds] = useState<string[]>(currentCategoryIds);
  const [themeIds, setThemeIds] = useState<string[]>(currentThemeIds);
  const [literaryMovementIds, setLiteraryMovementIds] = useState<string[]>(
    currentLiteraryMovementIds,
  );
  const [artTypeIds, setArtTypeIds] = useState<string[]>(currentArtTypeIds);
  const [artMovementIds, setArtMovementIds] = useState<string[]>(
    currentArtMovementIds,
  );
  const [keywordIds, setKeywordIds] = useState<string[]>(currentKeywordIds);
  const [attributeIds, setAttributeIds] = useState<string[]>(
    currentAttributeIds,
  );

  function handleOpen() {
    // Reset selections to current values whenever dialog opens
    setSubjectIds(currentSubjectIds);
    setCategoryIds(currentCategoryIds);
    setThemeIds(currentThemeIds);
    setLiteraryMovementIds(currentLiteraryMovementIds);
    setArtTypeIds(currentArtTypeIds);
    setArtMovementIds(currentArtMovementIds);
    setKeywordIds(currentKeywordIds);
    setAttributeIds(currentAttributeIds);
    setOpen(true);
  }

  // When externally controlled, reset selections whenever the dialog opens
  useEffect(() => {
    if (isControlled && open) {
      setSubjectIds(currentSubjectIds);
      setCategoryIds(currentCategoryIds);
      setThemeIds(currentThemeIds);
      setLiteraryMovementIds(currentLiteraryMovementIds);
      setArtTypeIds(currentArtTypeIds);
      setArtMovementIds(currentArtMovementIds);
      setKeywordIds(currentKeywordIds);
      setAttributeIds(currentAttributeIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, open]);

  function handleSave() {
    startTransition(async () => {
      try {
        await updateWorkTaxonomy(workId, {
          subjectIds,
          categoryIds,
          themeIds,
          literaryMovementIds,
          artTypeIds,
          artMovementIds,
          keywordIds,
          attributeIds,
        });
        toast.success("Taxonomy updated");
        setOpen(false);
        router.refresh();
        triggerActivityRefresh();
      } catch {
        toast.error("Failed to update taxonomy");
      }
    });
  }

  return (
    <>
      {!isControlled && (
        <button
          onClick={handleOpen}
          className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
        >
          <Tag className="h-3.5 w-3.5" strokeWidth={1.5} />
          Edit taxonomy
        </button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit taxonomy"
        description="Assign or remove taxonomy classifications for this work"
        className="max-w-3xl"
      >
        <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
          <MultiSelectSection
            title="Subjects"
            items={subjects}
            selectedIds={subjectIds}
            onChange={setSubjectIds}
          />
          <MultiSelectSection
            title="Categories"
            items={categories}
            selectedIds={categoryIds}
            onChange={setCategoryIds}
          />
          <MultiSelectSection
            title="Themes"
            items={themes}
            selectedIds={themeIds}
            onChange={setThemeIds}
          />
          <MultiSelectSection
            title="Literary Movements"
            items={literaryMovements}
            selectedIds={literaryMovementIds}
            onChange={setLiteraryMovementIds}
          />
          <MultiSelectSection
            title="Art Types"
            items={artTypes}
            selectedIds={artTypeIds}
            onChange={setArtTypeIds}
          />
          <MultiSelectSection
            title="Art Movements"
            items={artMovements}
            selectedIds={artMovementIds}
            onChange={setArtMovementIds}
          />
          <MultiSelectSection
            title="Keywords"
            items={keywords}
            selectedIds={keywordIds}
            onChange={setKeywordIds}
          />
          <MultiSelectSection
            title="Attributes"
            items={attributes}
            selectedIds={attributeIds}
            onChange={setAttributeIds}
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-glass-border pt-4">
          <Button
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
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
