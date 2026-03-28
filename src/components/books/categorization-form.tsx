"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";

interface Item {
  id: string;
  name: string;
}

interface MultiSelectSectionProps {
  title: string;
  items: Item[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function MultiSelectSection({
  title,
  items,
  selectedIds,
  onChange,
}: MultiSelectSectionProps) {
  const [filter, setFilter] = useState("");

  const filtered = filter
    ? items.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))
    : items;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-medium text-fg-secondary">{title}</h3>
        {selectedIds.length > 0 && (
          <Badge variant="muted">{selectedIds.length}</Badge>
        )}
      </div>
      {items.length > 8 && (
        <input
          type="text"
          placeholder={`Filter ${title.toLowerCase()}...`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-2 h-7 w-full rounded-sm border border-bg-tertiary bg-bg-primary px-2 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
        />
      )}
      {items.length === 0 ? (
        <p className="text-xs text-fg-muted">
          No {title.toLowerCase()} available
        </p>
      ) : (
        <div className="max-h-[200px] space-y-0.5 overflow-y-auto rounded-sm border border-bg-tertiary bg-bg-primary p-2">
          {filtered.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs text-fg-secondary hover:bg-bg-tertiary"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => toggle(item.id)}
                className="rounded-sm"
              />
              {item.name}
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-1 text-xs text-fg-muted">No matches</p>
          )}
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selectedIds.map((id) => {
            const item = items.find((i) => i.id === id);
            return item ? (
              <Badge key={id} variant="default">
                {item.name}
              </Badge>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
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
