"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { ArrowRight, Plus, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstanceForm, type InstanceDraft } from "@/components/books/instance-form";
import { StepFooter } from "../step-progress";
import type { LocationItem } from "../wizard-model";

/** Where the copies are, one form each. Skipping adds the book with none */
export function CopiesStep({
  drafts,
  onDraftsChange,
  newDraft,
  locations,
  wishlist,
  onBack,
  onSkip,
  onNext,
  cancel,
}: {
  drafts: InstanceDraft[];
  onDraftsChange: Dispatch<SetStateAction<InstanceDraft[]>>;
  /** Another copy, with the defaults from Settings */
  newDraft: () => InstanceDraft;
  locations: LocationItem[];
  wishlist: boolean;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
  cancel: ReactNode;
}) {
  function updateInstance(index: number, draft: InstanceDraft) {
    onDraftsChange((prev) =>
      prev.map((d, i) => (i === index ? draft : d)),
    );
  }

  function removeInstance(index: number) {
    onDraftsChange((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-fg-secondary">
        {wishlist
          ? "Optionally add copies if you already have this book."
          : "Where do you have this book? Add copies with their locations."}
      </p>

      {locations.length === 0 ? (
        <div className="rounded-sm border border-accent-red/30 bg-accent-red/5 p-4 text-xs text-fg-secondary">
          No locations exist yet. Go to{" "}
          <a href="/locations" className="text-accent-primary underline">
            /locations
          </a>{" "}
          to create one first.
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {drafts.map((draft, i) => (
              <InstanceForm
                key={i}
                index={i}
                value={draft}
                onChange={(d) => updateInstance(i, d)}
                onRemove={
                  drafts.length > 1
                    ? () => removeInstance(i)
                    : undefined
                }
                locations={locations}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => onDraftsChange((prev) => [...prev, newDraft()])}
            className="flex items-center gap-2 text-sm text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:min-h-11"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Add another copy
          </button>
        </>
      )}

      <StepFooter onBack={onBack} cancel={cancel}>
        <Button variant="ghost" onClick={onSkip}>
          <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
          Skip copies
        </Button>
        <Button data-shortcut="next" onClick={onNext}>
          Categorize
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </StepFooter>
    </div>
  );
}
