"use client";

import { MultiSelectSection } from "@/components/shared/multi-select-section";

interface Item {
  id: string;
  name: string;
}

interface CategorizationFormProps {
  subjects: Item[];
  genres: Item[];
  tags: Item[];
  collections: Item[];
  categories: Item[];
  themes: Item[];
  literaryMovements: Item[];
  artTypes: Item[];
  artMovements: Item[];
  keywords: Item[];
  attributes: Item[];
  selectedSubjectIds: string[];
  selectedGenreIds: string[];
  selectedTagIds: string[];
  selectedCollectionIds: string[];
  selectedCategoryIds: string[];
  selectedThemeIds: string[];
  selectedLiteraryMovementIds: string[];
  selectedArtTypeIds: string[];
  selectedArtMovementIds: string[];
  selectedKeywordIds: string[];
  selectedAttributeIds: string[];
  onSubjectsChange: (ids: string[]) => void;
  onGenresChange: (ids: string[]) => void;
  onTagsChange: (ids: string[]) => void;
  onCollectionsChange: (ids: string[]) => void;
  onCategoriesChange: (ids: string[]) => void;
  onThemesChange: (ids: string[]) => void;
  onLiteraryMovementsChange: (ids: string[]) => void;
  onArtTypesChange: (ids: string[]) => void;
  onArtMovementsChange: (ids: string[]) => void;
  onKeywordsChange: (ids: string[]) => void;
  onAttributesChange: (ids: string[]) => void;
}

export function CategorizationForm({
  subjects,
  genres,
  tags,
  collections,
  categories,
  themes,
  literaryMovements,
  artTypes,
  artMovements,
  keywords,
  attributes,
  selectedSubjectIds,
  selectedGenreIds,
  selectedTagIds,
  selectedCollectionIds,
  selectedCategoryIds,
  selectedThemeIds,
  selectedLiteraryMovementIds,
  selectedArtTypeIds,
  selectedArtMovementIds,
  selectedKeywordIds,
  selectedAttributeIds,
  onSubjectsChange,
  onGenresChange,
  onTagsChange,
  onCollectionsChange,
  onCategoriesChange,
  onThemesChange,
  onLiteraryMovementsChange,
  onArtTypesChange,
  onArtMovementsChange,
  onKeywordsChange,
  onAttributesChange,
}: CategorizationFormProps) {
  return (
    <div className="space-y-5">
      <MultiSelectSection
        title="Subjects"
        items={subjects}
        selectedIds={selectedSubjectIds}
        onChange={onSubjectsChange}
      />
      <MultiSelectSection
        title="Genres"
        items={genres}
        selectedIds={selectedGenreIds}
        onChange={onGenresChange}
      />
      <MultiSelectSection
        title="Categories"
        items={categories}
        selectedIds={selectedCategoryIds}
        onChange={onCategoriesChange}
      />
      <MultiSelectSection
        title="Themes"
        items={themes}
        selectedIds={selectedThemeIds}
        onChange={onThemesChange}
      />
      <MultiSelectSection
        title="Literary Movements"
        items={literaryMovements}
        selectedIds={selectedLiteraryMovementIds}
        onChange={onLiteraryMovementsChange}
      />
      <MultiSelectSection
        title="Art Types"
        items={artTypes}
        selectedIds={selectedArtTypeIds}
        onChange={onArtTypesChange}
      />
      <MultiSelectSection
        title="Art Movements"
        items={artMovements}
        selectedIds={selectedArtMovementIds}
        onChange={onArtMovementsChange}
      />
      <MultiSelectSection
        title="Keywords"
        items={keywords}
        selectedIds={selectedKeywordIds}
        onChange={onKeywordsChange}
      />
      <MultiSelectSection
        title="Attributes"
        items={attributes}
        selectedIds={selectedAttributeIds}
        onChange={onAttributesChange}
      />
      <MultiSelectSection
        title="Tags"
        items={tags}
        selectedIds={selectedTagIds}
        onChange={onTagsChange}
      />
      <MultiSelectSection
        title="Collections"
        items={collections}
        selectedIds={selectedCollectionIds}
        onChange={onCollectionsChange}
      />
    </div>
  );
}
