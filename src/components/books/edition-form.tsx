"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TitleInput } from "@/components/shared/title-input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { BINDING_TYPES, EDITION_CONTRIBUTOR_ROLES } from "@/lib/types/index";
import { languageOptions } from "@/lib/utils/language";
import { useAuthorSearch, type AuthorOption } from "@/hooks/use-author-search";

import {
  PublisherChip,
  PublisherSearch,
  type PublisherOption,
} from "@/components/publishers/publisher-picker";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContributorEntry {
  authorId: string;
  authorName: string;
  role: string;
}

export interface EditionFormValues {
  title: string;
  subtitle: string;
  isbn13: string;
  isbn10: string;
  asin: string;
  lccn: string;
  oclc: string;
  openLibraryKey: string;
  googleBooksId: string;
  goodreadsId: string;
  /** Confirmed publishing houses; undefined leaves them to automatic matching */
  publishers?: PublisherOption[];
  publisher: string;
  imprint: string;
  publicationYear: string;
  publicationDate: string;
  publicationCountry: string;
  editionName: string;
  editionNumber: string;
  printingNumber: string;
  isFirstEdition: boolean;
  isLimitedEdition: boolean;
  limitedEditionCount: string;
  language: string;
  isTranslated: boolean;
  pageCount: string;
  binding: string;
  heightMm: string;
  widthMm: string;
  depthMm: string;
  weightGrams: string;
  illustrationType: string;
  description: string;
  tableOfContents: string;
  notes: string;
  coverSourceUrl: string;
  metadataLocked: boolean;
  metadataSource: string;
  contributors: ContributorEntry[];
  genreIds: string[];
  tagIds: string[];
}

export const EMPTY_EDITION: EditionFormValues = {
  title: "",
  subtitle: "",
  isbn13: "",
  isbn10: "",
  asin: "",
  lccn: "",
  oclc: "",
  openLibraryKey: "",
  googleBooksId: "",
  goodreadsId: "",
  publisher: "",
  imprint: "",
  publicationYear: "",
  publicationDate: "",
  publicationCountry: "",
  editionName: "",
  editionNumber: "",
  printingNumber: "",
  isFirstEdition: false,
  isLimitedEdition: false,
  limitedEditionCount: "",
  language: "en",
  isTranslated: false,
  pageCount: "",
  binding: "",
  heightMm: "",
  widthMm: "",
  depthMm: "",
  weightGrams: "",
  illustrationType: "",
  description: "",
  tableOfContents: "",
  notes: "",
  coverSourceUrl: "",
  metadataLocked: false,
  metadataSource: "",
  contributors: [],
  genreIds: [],
  tagIds: [],
};

interface EditionFormProps {
  initialValues: EditionFormValues;
  availableGenres: { id: string; name: string }[];
  availableTags: { id: string; name: string }[];
  onSubmit: (values: EditionFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
  isPending: boolean;
  existingCoverUrl?: string | null;
}

// ── Section helper ─────────────────────────────────────────────────────────

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-glass-border pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-fg-secondary hover:text-fg-primary pointer-coarse:min-h-11"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
        )}
        {title}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Main form ──────────────────────────────────────────────────────────────

/**
 * The form's values as createEdition and updateEdition take them. A
 * contributor without an id is found by name, or created with the edition
 * in the same write. An empty language falls back to `defaultLanguage`; the
 * cover URL goes only when one was entered.
 */
export function editionPayload(values: EditionFormValues, defaultLanguage: string) {
  const contributorIds = values.contributors.map((c) =>
    c.authorId
      ? { authorId: c.authorId, role: c.role }
      : { authorName: c.authorName, role: c.role },
  );
  const int = (value: string) => (value ? parseInt(value, 10) : null);
  return {
    title: values.title,
    subtitle: values.subtitle || null,
    isbn13: values.isbn13 || null,
    isbn10: values.isbn10 || null,
    asin: values.asin || null,
    lccn: values.lccn || null,
    oclc: values.oclc || null,
    openLibraryKey: values.openLibraryKey || null,
    googleBooksId: values.googleBooksId || null,
    goodreadsId: values.goodreadsId || null,
    publisherIds: values.publishers?.map((p) => p.id),
    publisher: values.publisher || null,
    imprint: values.imprint || null,
    publicationYear: int(values.publicationYear),
    publicationDate: values.publicationDate || null,
    publicationCountry: values.publicationCountry || null,
    editionName: values.editionName || null,
    editionNumber: int(values.editionNumber),
    printingNumber: int(values.printingNumber),
    isFirstEdition: values.isFirstEdition,
    isLimitedEdition: values.isLimitedEdition,
    limitedEditionCount: int(values.limitedEditionCount),
    language: values.language || defaultLanguage,
    isTranslated: values.isTranslated,
    pageCount: int(values.pageCount),
    binding: values.binding || null,
    heightMm: int(values.heightMm),
    widthMm: int(values.widthMm),
    depthMm: int(values.depthMm),
    weightGrams: int(values.weightGrams),
    illustrationType: values.illustrationType || null,
    description: values.description || null,
    tableOfContents: values.tableOfContents || null,
    notes: values.notes || null,
    ...(values.coverSourceUrl ? { coverSourceUrl: values.coverSourceUrl } : {}),
    metadataLocked: values.metadataLocked,
    contributorIds,
    genreIds: values.genreIds,
    tagIds: values.tagIds,
  };
}

export function EditionForm({
  initialValues,
  availableGenres,
  availableTags,
  onSubmit,
  onCancel,
  submitLabel,
  isPending,
  existingCoverUrl,
}: EditionFormProps) {
  const [values, setValues] = useState<EditionFormValues>(initialValues);
  const [newContributorName, setNewContributorName] = useState("");
  const [newContributorRole, setNewContributorRole] = useState("translator");
  const [authorSearch, setAuthorSearch] = useState("");
  // The author picked from the suggestions, while the name field still shows it
  const [pickedAuthor, setPickedAuthor] = useState<AuthorOption | null>(null);

  function update<K extends keyof EditionFormValues>(
    field: K,
    v: EditionFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: v }));
  }

  function addContributor() {
    const trimmed = newContributorName.trim();
    if (!trimmed) return;

    // A typed name without a pick is found or created by the save, in its write
    const existing = pickedAuthor?.name === trimmed ? pickedAuthor : null;

    const entry: ContributorEntry = existing
      ? {
          authorId: existing.id,
          authorName: existing.name,
          role: newContributorRole,
        }
      : { authorId: "", authorName: trimmed, role: newContributorRole };

    update("contributors", [...values.contributors, entry]);
    setNewContributorName("");
    setAuthorSearch("");
    setPickedAuthor(null);
  }

  function removeContributor(index: number) {
    update(
      "contributors",
      values.contributors.filter((_, i) => i !== index),
    );
  }

  function toggleGenre(id: string) {
    const next = values.genreIds.includes(id)
      ? values.genreIds.filter((g) => g !== id)
      : [...values.genreIds, id];
    update("genreIds", next);
  }

  function toggleTag(id: string) {
    const next = values.tagIds.includes(id)
      ? values.tagIds.filter((t) => t !== id)
      : [...values.tagIds, id];
    update("tagIds", next);
  }

  // Author search runs on the server, so every author can be found
  const { results: filteredAuthors } = useAuthorSearch(authorSearch);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-0">
      {/* Section 1: Title & Identifiers */}
      <Section title="Title & Identifiers" defaultOpen>
        <TitleInput
          label="Title"
          id="ed-title"
          value={values.title}
          onValueChange={(v) => update("title", v)}
          language={values.language}
          required
          placeholder="Edition title..."
        />
        <TitleInput
          label="Subtitle"
          id="ed-subtitle"
          value={values.subtitle}
          onValueChange={(v) => update("subtitle", v)}
          language={values.language}
          placeholder="Optional subtitle..."
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="ISBN-13"
            id="ed-isbn13"
            value={values.isbn13}
            onChange={(e) => update("isbn13", e.target.value)}
            placeholder="9780000000000"
            maxLength={13}
            className="font-mono"
          />
          <Input
            label="ISBN-10"
            id="ed-isbn10"
            value={values.isbn10}
            onChange={(e) => update("isbn10", e.target.value)}
            placeholder="0000000000"
            maxLength={10}
            className="font-mono"
          />
        </div>
        <Section title="More identifiers">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="ASIN"
              id="ed-asin"
              value={values.asin}
              onChange={(e) => update("asin", e.target.value)}
              className="font-mono"
            />
            <Input
              label="LCCN"
              id="ed-lccn"
              value={values.lccn}
              onChange={(e) => update("lccn", e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="OCLC"
              id="ed-oclc"
              value={values.oclc}
              onChange={(e) => update("oclc", e.target.value)}
              className="font-mono"
            />
            <Input
              label="Open Library Key"
              id="ed-ol-key"
              value={values.openLibraryKey}
              onChange={(e) => update("openLibraryKey", e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Google Books ID"
              id="ed-gb-id"
              value={values.googleBooksId}
              onChange={(e) => update("googleBooksId", e.target.value)}
              className="font-mono"
            />
            <Input
              label="Goodreads ID"
              id="ed-gr-id"
              value={values.goodreadsId}
              onChange={(e) => update("goodreadsId", e.target.value)}
              className="font-mono"
            />
          </div>
        </Section>
      </Section>

      {/* Section 2: Publication */}
      <Section title="Publication" defaultOpen>
        <label className="flex items-center gap-2 text-sm text-fg-secondary pointer-coarse:min-h-11">
          <input
            type="checkbox"
            disabled={initialValues.publishers !== undefined}
            checked={values.publishers !== undefined}
            onChange={(e) =>
              update("publishers", e.target.checked ? [] : undefined)
            }
          />
          Choose publisher identities manually
        </label>
        {values.publishers !== undefined && (
          <div className="space-y-2">
            {values.publishers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {values.publishers.map((p) => (
                  <PublisherChip
                    key={p.id}
                    publisher={p}
                    onRemove={() =>
                      update(
                        "publishers",
                        values.publishers!.filter((v) => v.id !== p.id),
                      )
                    }
                  />
                ))}
              </div>
            )}
            <PublisherSearch
              label="Publishing house"
              exclude={values.publishers.map((p) => p.id)}
              allowCreate
              onSelect={(p) =>
                update("publishers", [...values.publishers!, p])
              }
            />
            <p className="text-xs text-fg-secondary">
              These links are preserved during metadata refresh. The original
              publication text stays below.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Publisher"
            id="ed-publisher"
            value={values.publisher}
            onChange={(e) => update("publisher", e.target.value)}
          />
          <Input
            label="Imprint"
            id="ed-imprint"
            value={values.imprint}
            onChange={(e) => update("imprint", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Publication year"
            id="ed-pub-year"
            type="number"
            value={values.publicationYear}
            onChange={(e) => update("publicationYear", e.target.value)}
            placeholder="2003"
          />
          <DatePicker
            label="Publication date"
            id="ed-pub-date"
            value={values.publicationDate}
            onChange={(v) => update("publicationDate", v)}
          />
        </div>
        <Input
          label="Publication country"
          id="ed-pub-country"
          value={values.publicationCountry}
          onChange={(e) => update("publicationCountry", e.target.value)}
          placeholder="United Kingdom"
        />
      </Section>

      {/* Section 3: Edition Details */}
      <Section title="Edition details">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Edition name"
            id="ed-edition-name"
            value={values.editionName}
            onChange={(e) => update("editionName", e.target.value)}
            placeholder="Penguin Classics"
          />
          <Input
            label="Edition number"
            id="ed-edition-number"
            type="number"
            value={values.editionNumber}
            onChange={(e) => update("editionNumber", e.target.value)}
          />
        </div>
        <Input
          label="Printing number"
          id="ed-printing-number"
          type="number"
          value={values.printingNumber}
          onChange={(e) => update("printingNumber", e.target.value)}
        />
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-xs text-fg-secondary pointer-coarse:min-h-11">
            <input
              type="checkbox"
              checked={values.isFirstEdition}
              onChange={(e) => update("isFirstEdition", e.target.checked)}
              className="rounded-sm"
            />
            First edition
          </label>
          <label className="flex items-center gap-2 text-xs text-fg-secondary pointer-coarse:min-h-11">
            <input
              type="checkbox"
              checked={values.isLimitedEdition}
              onChange={(e) => update("isLimitedEdition", e.target.checked)}
              className="rounded-sm"
            />
            Limited edition
          </label>
        </div>
        {values.isLimitedEdition && (
          <Input
            label="Limited edition count"
            id="ed-limited-count"
            type="number"
            value={values.limitedEditionCount}
            onChange={(e) => update("limitedEditionCount", e.target.value)}
            placeholder="500"
          />
        )}
      </Section>

      {/* Section 4: Language */}
      <Section title="Language">
        <Select
          label="Language"
          id="ed-language"
          value={values.language}
          onChange={(e) => update("language", e.target.value)}
          options={languageOptions(initialValues.language)}
        />
        <label className="flex items-center gap-2 text-xs text-fg-secondary pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={values.isTranslated}
            onChange={(e) => update("isTranslated", e.target.checked)}
            className="rounded-sm"
          />
          This is a translation
        </label>
      </Section>

      {/* Section 5: Physical Description */}
      <Section title="Physical description">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Page count"
            id="ed-pages"
            type="number"
            value={values.pageCount}
            onChange={(e) => update("pageCount", e.target.value)}
          />
          <Select
            label="Binding"
            id="ed-binding"
            value={values.binding}
            onChange={(e) => update("binding", e.target.value)}
            placeholder="Select binding..."
            options={BINDING_TYPES.map((b) => ({
              value: b,
              label: b.replace(/_/g, " "),
            }))}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Height (mm)"
            id="ed-height"
            type="number"
            value={values.heightMm}
            onChange={(e) => update("heightMm", e.target.value)}
          />
          <Input
            label="Width (mm)"
            id="ed-width"
            type="number"
            value={values.widthMm}
            onChange={(e) => update("widthMm", e.target.value)}
          />
          <Input
            label="Depth (mm)"
            id="ed-depth"
            type="number"
            value={values.depthMm}
            onChange={(e) => update("depthMm", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Weight (grams)"
            id="ed-weight"
            type="number"
            value={values.weightGrams}
            onChange={(e) => update("weightGrams", e.target.value)}
          />
          <Input
            label="Illustration type"
            id="ed-illustrations"
            value={values.illustrationType}
            onChange={(e) => update("illustrationType", e.target.value)}
            placeholder="B&W plates, colour maps..."
          />
        </div>
      </Section>

      {/* Section 6: Content */}
      <Section title="Content">
        <Textarea
          label="Description"
          id="ed-description"
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="Edition-specific description..."
        />
        <Textarea
          label="Table of contents"
          id="ed-toc"
          value={values.tableOfContents}
          onChange={(e) => update("tableOfContents", e.target.value)}
          placeholder="Chapter list or TOC..."
        />
        <Textarea
          label="Notes"
          id="ed-notes"
          value={values.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="Personal notes..."
        />
      </Section>

      {/* Section 7: Cover */}
      <Section title="Cover">
        {existingCoverUrl && (
          <div className="mb-2">
            <p className="mb-1.5 text-xs text-fg-secondary">Current cover</p>
            <img
              src={existingCoverUrl}
              alt="Current cover"
              className="h-24 w-auto rounded-sm border border-glass-border object-cover"
            />
          </div>
        )}
        <Input
          label="Cover source URL"
          id="ed-cover-url"
          type="url"
          value={values.coverSourceUrl}
          onChange={(e) => update("coverSourceUrl", e.target.value)}
          placeholder="https://..."
        />
        <p className="text-xs text-fg-secondary">
          Entering a new URL will re-process the cover on save.
        </p>
      </Section>

      {/* Section 8: Contributors */}
      <Section title="Contributors">
        {values.contributors.length > 0 && (
          <div className="space-y-1.5">
            {values.contributors.map((c, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-sm border border-glass-border bg-bg-primary px-3 py-2"
              >
                <span className="flex-1 text-xs text-fg-secondary">
                  {c.authorName}
                </span>
                <span className="text-xs text-fg-secondary capitalize">
                  {c.role}
                </span>
                <button
                  aria-label="Remove contributor"
                  data-tooltip="Remove contributor"
                  type="button"
                  onClick={() => removeContributor(i)}
                  className="text-fg-muted hover:text-accent-red"
                >
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <p className="text-xs font-medium text-fg-secondary">
            Add contributor
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Input
                id="ed-contributor-name"
                placeholder="Author name..."
                value={newContributorName}
                onChange={(e) => {
                  setNewContributorName(e.target.value);
                  setAuthorSearch(e.target.value);
                  setPickedAuthor(null);
                }}
              />
              {authorSearch && filteredAuthors.length > 0 && (
                <div className="absolute top-full z-10 mt-0.5 w-full rounded-sm border border-glass-border bg-bg-secondary shadow-sm">
                  {filteredAuthors.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setNewContributorName(a.name);
                        setAuthorSearch("");
                        setPickedAuthor(a);
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Select
              id="ed-contributor-role"
              value={newContributorRole}
              onChange={(e) => setNewContributorRole(e.target.value)}
              options={EDITION_CONTRIBUTOR_ROLES.map((r) => ({
                value: r,
                label: r.replace(/_/g, " "),
              }))}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addContributor}
            disabled={!newContributorName.trim()}
          >
            <Plus className="h-3 w-3" strokeWidth={1.5} />
            Add
          </Button>
        </div>
      </Section>

      {/* Section 9: Genres & Tags */}
      <Section title="Genres & Tags">
        {availableGenres.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-fg-secondary">Genres</p>
            <div className="flex flex-wrap gap-2">
              {availableGenres.map((g) => {
                const selected = values.genreIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGenre(g.id)}
                    className={`rounded-sm border px-2 py-0.5 text-xs transition-colors ${
                      selected
                        ? "border-accent-rose bg-accent-rose/10 text-accent-rose-text"
                        : "border-glass-border text-fg-secondary hover:border-fg-muted hover:text-fg-primary"
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {availableTags.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-fg-secondary">Tags</p>
            <div className="flex flex-wrap gap-2">
              {availableTags.map((t) => {
                const selected = values.tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className={`rounded-sm border px-2 py-0.5 text-xs transition-colors ${
                      selected
                        ? "border-accent-rose bg-accent-rose/10 text-accent-rose-text"
                        : "border-glass-border text-fg-secondary hover:border-fg-muted hover:text-fg-primary"
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* Section 10: Metadata */}
      <Section title="Metadata">
        <label className="flex items-center gap-2 text-xs text-fg-secondary pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={values.metadataLocked}
            onChange={(e) => update("metadataLocked", e.target.checked)}
            className="rounded-sm"
          />
          Lock metadata (prevent auto-updates)
        </label>
        {values.metadataSource && (
          <p className="text-xs text-fg-secondary">
            Source:{" "}
            <span className="text-fg-secondary">{values.metadataSource}</span>
          </p>
        )}
      </Section>

      {/* Submit */}
      <div className="flex items-center justify-end gap-2 border-t border-glass-border pt-4">
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isPending || !values.title.trim()}
        >
          {isPending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
