"use client";

import { Input } from "@/components/ui/input";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import type { AssignedTaxonomyItem, getTaxonomyAssignments } from "@/lib/actions/taxonomy-families";
import { createTaxonomyItem, searchTaxonomyItems } from "@/lib/actions/taxonomy-client";
import { refusalMessage } from "@/lib/actions/refusal";
import { replaceTaxonomyAssignments } from "@/lib/actions/taxonomy-client";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { normalizeSearchText } from "@/lib/utils/search-text";

type Family = Awaited<ReturnType<typeof getTaxonomyAssignments>>[number];

interface TaxonomyAssignmentsProps {
  kind: WorkKind;
  level: "work" | "edition";
  ownerId: string;
  families: Family[];
  /**
   * Shows each family's name beside its terms. Off where a heading already
   * names the one family (a film's Genres): the name is kept for screen
   * readers and the terms take the full width.
   */
  labelled?: boolean;
}

/**
 * The record's terms in each family that applies to its domain and level.
 * Each change saves at once; a refused change keeps the stored terms.
 */
export function TaxonomyAssignments({
  kind,
  level,
  ownerId,
  families,
  labelled = true,
}: TaxonomyAssignmentsProps) {
  if (!families.length) return null;
  return (
    <div className="space-y-3 pointer-coarse:space-y-6.5">
      {families.map((family) => (
        <FamilyAssignment
          key={family.id}
          family={family}
          kind={kind}
          level={level}
          ownerId={ownerId}
          labelled={labelled}
        />
      ))}
    </div>
  );
}

function FamilyAssignment({
  family,
  kind,
  level,
  ownerId,
  labelled,
}: { family: Family } & Omit<TaxonomyAssignmentsProps, "families">) {
  const router = useRouter();
  const [items, setItems] = useState(family.items);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  useEffect(() => setItems(family.items), [family.items]);
  // Keyboard users keep their place: after a pick, a removal or Escape,
  // focus returns to this family's Add button.
  const addButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!searching && refocus.current && !addButton.current?.disabled) {
      refocus.current = false;
      addButton.current?.focus();
    }
  });
  const closeSearch = () => {
    refocus.current = true;
    setSearching(false);
  };

  async function save(next: AssignedTaxonomyItem[]) {
    const previous = items;
    setItems(next);
    setSaving(true);
    try {
      await replaceTaxonomyAssignments({
        familySlug: family.slug,
        kind,
        level,
        ownerId,
        itemIds: next.map((item) => item.id),
      });
      router.refresh();
    } catch (err) {
      setItems(previous);
      toast.error(refusalMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  }

  // The label and Add take a 26px line, a chip's height (its 20px line,
  // padding and border), so all three share one text line
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 text-sm">
      <span
        className={labelled ? "w-32 shrink-0 text-xs leading-6.5 text-fg-secondary" : "sr-only"}
      >
        {family.name}
      </span>
      {/* On touch each 44px press area (a chip's cross, Add) reaches 9px past
          its 26px line: rows and rows of families sit 26px apart, and a chip's
          cross stays inside it, so press areas keep 8px between them */}
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-1.5 pointer-coarse:gap-x-4 pointer-coarse:gap-y-6.5">
        {items.map((item) => (
          <span
            key={item.id}
            className="inline-flex items-start gap-1 rounded-sm border border-glass-border bg-bg-secondary/60 py-0.5 pl-2 pr-1 text-xs leading-5 text-fg-secondary pointer-coarse:pr-4"
          >
            {item.parentName && (
              <span className="text-fg-secondary">{item.parentName} ›</span>
            )}
            <Link href={`/taxonomy/${family.slug}/${item.slug ?? item.id}`} className="min-w-0 break-words text-command touch-hit">{item.name}</Link>
            {/* CapAlignedControls clips nothing, so the button's 44px press area reaches past the chip on touch */}
            <CapAlignedControls height={16}>
              <button
                type="button"
                aria-label={`Remove ${item.name} from ${family.name}`}
                data-tooltip={`Remove ${item.name} from ${family.name}`}
                disabled={saving}
                onClick={() => {
                  refocus.current = true;
                  save(items.filter((i) => i.id !== item.id));
                }}
                className="flex h-4 w-4 items-center justify-center rounded-sm text-fg-muted transition-colors hover:text-fg-primary focus-visible:-outline-offset-2 touch-hit"
              >
                <X className="h-3 w-3" strokeWidth={1.5} />
              </button>
            </CapAlignedControls>
          </span>
        ))}
        {searching ? (
          <TaxonomyItemSearch
            family={family}
            exclude={new Set(items.map((item) => item.id))}
            onPick={(item) => {
              closeSearch();
              save([...items, item]);
            }}
            onClose={closeSearch}
          />
        ) : (
          <button
            ref={addButton}
            type="button"
            disabled={saving}
            onClick={() => setSearching(true)}
            aria-label={`Add to ${family.name}`}
            className="-ml-1.5 inline-flex items-start gap-1 rounded-sm px-1.5 text-xs leading-6.5 text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
          >
            <CapAligned height={12}>
              <Plus className="h-3 w-3" strokeWidth={1.5} />
            </CapAligned>
            Add
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A bounded search over one family. The field is a `data-picker`, so ↑ ↓ and
 * Enter pick a choice (shortcuts provider); Escape closes it. Also used by
 * the perfume note and classification editors.
 */
export function TaxonomyItemSearch({
  family,
  exclude,
  onPick,
  onClose,
}: {
  family: Pick<Family, "slug" | "name">;
  exclude: Set<string>;
  onPick: (item: AssignedTaxonomyItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    items: AssignedTaxonomyItem[];
    hasMore: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      searchTaxonomyItems(family.slug, { query, limit: 12 })
        .then((found) => live && (setResult(found), setError(null)))
        .catch(() => live && setError("Search failed"));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [family.slug, query]);

  const choices = (result?.items ?? []).filter((item) => !exclude.has(item.id));
  const name = query.trim();
  // "decadence" is "Décadence": no Create beside the item it would repeat
  const exact = (result?.items ?? []).some(
    (item) => normalizeSearchText(item.name) === normalizeSearchText(name),
  );

  async function create() {
    setCreating(true);
    try {
      const item = await createTaxonomyItem(family.slug, { name });
      onPick({ id: item.id, name: item.name, parentName: null });
    } catch (err) {
      setError(refusalMessage(err, "Could not create"));
      setCreating(false);
    }
  }

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      <Input
        ref={input}
        data-picker
        type="search"
        value={query}
        maxLength={200}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), onClose())}
        placeholder={`Search ${family.name.toLowerCase()}...`}
        aria-label={`Search ${family.name}`}
        containerClassName="w-48 max-w-full"
      />
      <div className="absolute left-0 top-8 pointer-coarse:top-12 z-20 w-64 rounded-sm border border-glass-border bg-bg-secondary py-1 shadow-lg">
        {error && <p className="px-2 py-1 text-xs text-accent-red-text">{error}</p>}
        {!error && result === null && (
          <p className="px-2 py-1 text-xs text-fg-secondary">Searching…</p>
        )}
        {choices.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item)}
            className="block w-full truncate px-2 py-1 text-left text-xs text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
          >
            {item.parentName && (
              <span className="text-fg-secondary">{item.parentName} › </span>
            )}
            {item.name}
          </button>
        ))}
        {result && !choices.length && !name && (
          <p className="px-2 py-1 text-xs text-fg-secondary">No items yet</p>
        )}
        {result?.hasMore && (
          <p className="px-2 py-1 text-micro text-fg-secondary">
            More match; type to narrow the list
          </p>
        )}
        {name && result && !exact && (
          <button
            type="button"
            disabled={creating}
            aria-busy={creating || undefined}
            onClick={create}
            className="block w-full truncate px-2 py-1 text-left text-xs text-accent-primary hover:bg-bg-tertiary"
          >
            {`Create “${name}”`}
          </button>
        )}
      </div>
    </div>
  );
}
