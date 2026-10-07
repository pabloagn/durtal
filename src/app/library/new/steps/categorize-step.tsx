"use client";

import type { ReactNode } from "react";
import { ArrowRight, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategorizationForm } from "@/components/books/categorization-form";
import { StepFooter } from "../step-progress";
import type { TaxonomyKey, TaxonomyLists, TaxonomySelection } from "../wizard-model";

/** The book's taxonomy and collections, all optional */
export function CategorizeStep({
  lists,
  taxonomy,
  onChange,
  onBack,
  onNext,
  cancel,
}: {
  lists: TaxonomyLists;
  taxonomy: TaxonomySelection;
  onChange: (key: TaxonomyKey, ids: string[]) => void;
  onBack: () => void;
  onNext: () => void;
  cancel: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <CategorizationForm
        {...lists}
        selectedSubjectIds={taxonomy.subjects}
        selectedGenreIds={taxonomy.genres}
        selectedTagIds={taxonomy.tags}
        selectedCollectionIds={taxonomy.collections}
        selectedCategoryIds={taxonomy.categories}
        selectedThemeIds={taxonomy.themes}
        selectedLiteraryMovementIds={taxonomy.literaryMovements}
        selectedArtTypeIds={taxonomy.artTypes}
        selectedArtMovementIds={taxonomy.artMovements}
        selectedKeywordIds={taxonomy.keywords}
        selectedAttributeIds={taxonomy.attributes}
        onSubjectsChange={(ids) => onChange("subjects", ids)}
        onGenresChange={(ids) => onChange("genres", ids)}
        onTagsChange={(ids) => onChange("tags", ids)}
        onCollectionsChange={(ids) => onChange("collections", ids)}
        onCategoriesChange={(ids) => onChange("categories", ids)}
        onThemesChange={(ids) => onChange("themes", ids)}
        onLiteraryMovementsChange={(ids) => onChange("literaryMovements", ids)}
        onArtTypesChange={(ids) => onChange("artTypes", ids)}
        onArtMovementsChange={(ids) => onChange("artMovements", ids)}
        onKeywordsChange={(ids) => onChange("keywords", ids)}
        onAttributesChange={(ids) => onChange("attributes", ids)}
      />

      <StepFooter onBack={onBack} cancel={cancel}>
        <Button variant="ghost" onClick={onNext}>
          <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
          Skip
        </Button>
        <Button data-shortcut="next" onClick={onNext}>
          Review
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </StepFooter>
    </div>
  );
}
