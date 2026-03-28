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
  selectedSubjectIds: string[];
  selectedGenreIds: string[];
  selectedTagIds: string[];
  selectedCollectionIds: string[];
  onSubjectsChange: (ids: string[]) => void;
  onGenresChange: (ids: string[]) => void;
  onTagsChange: (ids: string[]) => void;
  onCollectionsChange: (ids: string[]) => void;
}

export function CategorizationForm({
  subjects,
  genres,
  tags,
  collections,
  selectedSubjectIds,
  selectedGenreIds,
  selectedTagIds,
  selectedCollectionIds,
  onSubjectsChange,
  onGenresChange,
  onTagsChange,
  onCollectionsChange,
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
