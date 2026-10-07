"use client";

import type { ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { InstanceDraft } from "@/components/books/instance-form";
import { languageName } from "@/lib/utils/language";
import { bindingLabel } from "@/lib/utils/binding";
import { catalogueStatusLabel, enumLabel, priorityLabel } from "@/lib/utils/labels";
import { StepFooter } from "../step-progress";
import {
  TAXONOMY_KEYS,
  type EditionDraft,
  type LocationItem,
  type Step,
  type TaxonomyKey,
  type TaxonomyLists,
  type TaxonomySelection,
  type WorkDraft,
} from "../wizard-model";

type BadgeVariant = "default" | "blue" | "sage" | "muted" | "gold";

/** Each family's chosen items, in this order and colour */
const TAXONOMY_BADGES: [TaxonomyKey, BadgeVariant][] = [
  ["subjects", "default"],
  ["genres", "blue"],
  ["categories", "sage"],
  ["themes", "default"],
  ["literaryMovements", "blue"],
  ["artTypes", "muted"],
  ["artMovements", "muted"],
  ["keywords", "default"],
  ["attributes", "default"],
  ["tags", "muted"],
  ["collections", "gold"],
];

/** Everything about to be saved, each part with a way back to edit it */
export function ConfirmStep({
  work,
  edition,
  existingWork,
  copies,
  locations,
  taxonomy,
  lists,
  saving,
  onEdit,
  onEditCopies,
  onBack,
  onSubmit,
  cancel,
}: {
  work: WorkDraft;
  edition: EditionDraft;
  /** The book is an edition of an existing work */
  existingWork: boolean;
  /** The copies that will be created */
  copies: InstanceDraft[];
  locations: LocationItem[];
  taxonomy: TaxonomySelection;
  lists: TaxonomyLists;
  saving: boolean;
  onEdit: (step: Step) => void;
  onEditCopies: () => void;
  onBack: () => void;
  onSubmit: () => void;
  cancel: ReactNode;
}) {
  const { catalogueStatus, acquisitionPriority } = work;
  return (
    <div className="space-y-6">
      {/* Work */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="type-caption">
                Work
              </p>
              <h3 className="type-item-title mt-1">
                {work.title}
              </h3>
              <p className="mt-0.5 text-xs text-fg-secondary">
                {work.authorName}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {work.originalYear && (
                  <Badge variant="muted">{work.originalYear}</Badge>
                )}
                <Badge variant="muted">{languageName(work.originalLanguage)}</Badge>
                {work.seriesName && (
                  <Badge variant="blue">
                    {work.seriesName}
                    {work.seriesPosition && ` #${work.seriesPosition}`}
                  </Badge>
                )}
                <Badge
                  variant={
                    catalogueStatus === "accessioned"
                      ? "sage"
                      : catalogueStatus === "wanted" || catalogueStatus === "shortlisted"
                        ? "gold"
                        : "muted"
                  }
                >
                  {catalogueStatusLabel(catalogueStatus)}
                </Badge>
                {acquisitionPriority !== "none" && (
                  <Badge variant="blue">{priorityLabel(acquisitionPriority)} priority</Badge>
                )}
                {existingWork && (
                  <Badge variant="gold">Existing work</Badge>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(existingWork ? "edition" : "details")}
            >
              Edit
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edition */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="type-caption">
                Edition
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
                {edition.isbn13 && (
                  <span className="font-mono">{edition.isbn13}</span>
                )}
                {edition.publisher && <span>{edition.publisher}</span>}
                {edition.publicationYear && (
                  <span className="font-mono">{edition.publicationYear}</span>
                )}
                {edition.binding && <Badge variant="muted">{bindingLabel(edition.binding)}</Badge>}
                {edition.pageCount && <span>{edition.pageCount} pp.</span>}
              </div>
              {edition.coverUrl && (
                <img
                  src={edition.coverUrl}
                  alt="Cover preview"
                  className="mt-3 h-24 w-16 rounded-sm object-cover"
                />
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit("edition")}
            >
              Edit
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Instances */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-start justify-between">
            <div className="w-full">
              <p className="type-caption">
                Copies ({copies.length})
              </p>
              <div className="mt-2 space-y-2">
                {copies.length === 0 ? (
                  <p className="text-xs text-fg-secondary">
                    No copies -- you can add them later from the book detail page.
                  </p>
                ) : (
                  copies.map((d, i) => {
                    const loc = locations.find(
                      (l) => l.id === d.locationId,
                    );
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs text-fg-secondary"
                      >
                        <span className="text-fg-primary">
                          {loc?.name ?? "Unknown"}
                        </span>
                        {d.format && (
                          <Badge variant="muted">{enumLabel(d.format)}</Badge>
                        )}
                        {d.condition && (
                          <Badge variant="sage">
                            {enumLabel(d.condition)}
                          </Badge>
                        )}
                        {d.isSigned && (
                          <Badge variant="gold">Signed</Badge>
                        )}
                        {d.isFirstPrinting && (
                          <Badge variant="gold">1st printing</Badge>
                        )}
                        {d.acquisitionPrice && d.acquisitionCurrency && (
                          <span className="font-mono text-fg-secondary">
                            {d.acquisitionPrice} {d.acquisitionCurrency}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onEditCopies}>
              Edit
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Categorization */}
      {TAXONOMY_KEYS.some((key) => taxonomy[key].length > 0) && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="type-caption">
                  Categorization
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {TAXONOMY_BADGES.flatMap(([key, variant]) =>
                    taxonomy[key].map((id) => {
                      const item = lists[key].find((x) => x.id === id);
                      return item ? (
                        <Badge key={`${key}-${id}`} variant={variant}>
                          {item.name}
                        </Badge>
                      ) : null;
                    }),
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit("categorize")}
              >
                Edit
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <StepFooter onBack={onBack} cancel={cancel}>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          Add to catalogue
        </Button>
      </StepFooter>
    </div>
  );
}
