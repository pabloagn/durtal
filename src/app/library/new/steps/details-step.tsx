"use client";

import type { ReactNode } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { TitleInput } from "@/components/shared/title-input";
import { AuthorNameInput } from "@/components/shared/author-name-input";
import { StepFooter } from "../step-progress";
import {
  LANGUAGE_OPTIONS,
  isWishlistStatus,
  type RefDataItem,
  type WorkDraft,
} from "../wizard-model";

/**
 * The work. Fast Track saves the book from here, skipping copies and
 * categorization; with an existing work there is no Fast Track.
 */
export function DetailsStep({
  work,
  onChange,
  recommenders,
  addingEdition,
  fastTrackSaving,
  fastTrackError,
  onFastTrack,
  onBack,
  onNext,
  cancel,
}: {
  work: WorkDraft;
  onChange: (patch: Partial<WorkDraft>) => void;
  recommenders: RefDataItem[];
  /** The book is an edition of an existing work */
  addingEdition: boolean;
  fastTrackSaving: boolean;
  fastTrackError: string | null;
  onFastTrack: () => void;
  onBack: () => void;
  onNext: () => void;
  cancel: ReactNode;
}) {
  const { recommenderIds } = work;
  return (
    <fieldset
      disabled={fastTrackSaving}
      className="min-w-0 space-y-6"
      aria-busy={fastTrackSaving}
    >
      <div className="space-y-4">
        <TitleInput
          label="Title"
          id="title"
          value={work.title}
          onValueChange={(title) => onChange({ title })}
          language={work.originalLanguage}
          placeholder="The Master and Margarita"
          required
          autoFocus
        />
        <AuthorNameInput
          label="Author"
          id="author"
          value={work.authorName}
          onValueChange={(authorName) => onChange({ authorName })}
          placeholder="Mikhail Bulgakov"
          required
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Original year"
            id="originalYear"
            type="number"
            value={work.originalYear}
            onChange={(e) => onChange({ originalYear: e.target.value })}
            placeholder="1967"
          />
          <Select
            label="Original language"
            id="originalLanguage"
            value={work.originalLanguage}
            onChange={(e) => onChange({ originalLanguage: e.target.value })}
            options={LANGUAGE_OPTIONS}
          />
        </div>
        <Textarea
          label="Description"
          id="description"
          value={work.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Brief description of the work..."
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Series name"
            id="seriesName"
            value={work.seriesName}
            onChange={(e) => onChange({ seriesName: e.target.value })}
            placeholder="The Dark Tower"
          />
          <Input
            label="Series position"
            id="seriesPosition"
            value={work.seriesPosition}
            onChange={(e) => onChange({ seriesPosition: e.target.value })}
            placeholder="1"
          />
        </div>

        <div>
          <label htmlFor="wizard-recommender" className="type-label mb-1.5 block">
            Recommended by
          </label>
          {recommenderIds.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {recommenderIds.map((id) => {
                const r = recommenders.find((x) => x.id === id);
                return r ? (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-sm bg-bg-tertiary px-2 py-0.5 text-xs text-fg-secondary"
                  >
                    {r.name}
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ recommenderIds: recommenderIds.filter((x) => x !== id) })
                      }
                      className="ml-0.5 text-fg-secondary hover:text-fg-primary"
                    >
                      x
                    </button>
                  </span>
                ) : null;
              })}
            </div>
          )}
          <select
            id="wizard-recommender"
            value=""
            onChange={(e) => {
              const val = e.target.value;
              if (val && !recommenderIds.includes(val)) {
                onChange({ recommenderIds: [...recommenderIds, val] });
              }
            }}
            className="h-9 w-full appearance-none rounded-sm border border-glass-border bg-bg-secondary px-3 text-sm text-fg-primary transition-colors focus:border-accent-rose focus:outline-none"
          >
            <option value="">Add recommender...</option>
            {recommenders
              .filter((r) => !recommenderIds.includes(r.id))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </div>

        <div className="border-t border-bg-tertiary pt-4 mt-2">
          <p className="type-caption mb-3">
            Catalogue status
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Status"
              id="catalogueStatus"
              value={work.catalogueStatus}
              onChange={(e) => onChange({ catalogueStatus: e.target.value })}
              options={[
                { value: "tracked", label: "Tracked" },
                { value: "shortlisted", label: "Shortlisted" },
                { value: "wanted", label: "Wanted" },
                { value: "on_order", label: "On Order" },
                { value: "accessioned", label: "Accessioned" },
              ]}
            />
            <Select
              label="Priority"
              id="acquisitionPriority"
              value={work.acquisitionPriority}
              onChange={(e) => onChange({ acquisitionPriority: e.target.value })}
              options={[
                { value: "none", label: "None" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
            />
          </div>
          {isWishlistStatus(work.catalogueStatus) && (
            <p className="mt-2 text-xs text-fg-secondary">
              You can add copies later from the book detail page.
            </p>
          )}
        </div>
      </div>

      {fastTrackError && (
        <p role="alert" className="text-sm text-accent-red-text">
          {fastTrackError}
        </p>
      )}
      <StepFooter onBack={onBack} cancel={cancel}>
        {!addingEdition && (
          <Button
            type="button"
            variant="primary"
            data-shortcut="next"
            onClick={onFastTrack}
            disabled={fastTrackSaving || !work.title.trim() || !work.authorName.trim()}
            data-tooltip="Save now, skipping copies and categorization"
            data-tooltip-keys="enter"
          >
            {fastTrackSaving && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            )}
            Fast Track
          </Button>
        )}
        <Button
          data-shortcut={addingEdition ? "next" : undefined}
          onClick={onNext}
        >
          Edition details
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </StepFooter>
    </fieldset>
  );
}
