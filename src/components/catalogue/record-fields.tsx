"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { TaxonomyItemSearch } from "@/components/taxonomy/taxonomy-assignments";
import { getOrganizations, saveOrganization } from "@/lib/actions/organizations";
import { createPerson, getPeople } from "@/lib/actions/people";
import type { WorkKind } from "@/lib/catalogue/kinds";
import type { OrganizationRole } from "@/lib/catalogue/organizations";
import { SearchPicker, type PickerChoice } from "./search-picker";

/*
 * The pieces of a record form shared by every collection: chips with Remove,
 * "Add" that opens a search, a labelled row, one chosen record, organization
 * and person searches, and vocabulary terms.
 */

/** A chip is one 44px line on touch, so its Remove and role menu are 44px targets */
export const CHIP =
  "inline-flex max-w-full items-start gap-1 rounded-sm border border-glass-border bg-bg-secondary/60 py-0.5 pl-2 pr-1 text-xs leading-5 text-fg-secondary pointer-coarse:py-0 pointer-coarse:leading-11";

/**
 * A chip's name. On a phone's width it wraps in full instead of being cut
 * (a long organization in 260px); on touch its lines keep the 44px line's
 * center for the cross
 */
export const CHIP_NAME =
  "truncate max-sm:whitespace-normal max-sm:break-words max-sm:pointer-coarse:py-2.5 max-sm:pointer-coarse:leading-6";

/**
 * A chip that holds a menu besides its name (a role, an attribution). On
 * touch, where the menu and the cross are 44px, and on a phone's width, the
 * name takes a line of its own, so it is never cut, with the menu and the
 * cross under it. On touch the name's line centers where a 44px line does
 */
export const ROLE_CHIP = `${CHIP} pointer-coarse:flex-wrap max-sm:flex-wrap`;
export const ROLE_CHIP_NAME =
  "truncate pointer-coarse:order-first pointer-coarse:basis-full pointer-coarse:whitespace-normal pointer-coarse:break-words pointer-coarse:py-2.5 pointer-coarse:leading-6 max-sm:order-first max-sm:basis-full max-sm:whitespace-normal max-sm:break-words";

/** The remove button of a chip, on the cap-height center of its text; 44px on touch */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <CapAligned height={16} coarseHeight={44}>
      <button
        type="button"
        aria-label={label}
        data-tooltip={label}
        onClick={onClick}
        className="flex h-4 w-4 items-center justify-center rounded-sm text-fg-muted transition-colors hover:text-fg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-primary pointer-coarse:size-11"
      >
        <X className="h-3 w-3" strokeWidth={1.5} />
      </button>
    </CapAligned>
  );
}

/** "Add" beside a field's chips; focus comes back to it after a pick or Escape */
export function useAddButton() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  });
  const close = useCallback(() => {
    refocus.current = true;
    setOpen(false);
  }, []);
  return { open, setOpen, button, close };
}

export function AddButton({
  label,
  text = "Add",
  onClick,
  buttonRef,
}: {
  label: string;
  text?: string;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  // On a phone, starting a row under its label, it pulls out by its padding
  // so its icon starts on the label's edge (docs/03, Spacing Scale)
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-start gap-1 rounded-sm px-1.5 pt-px text-xs leading-6 text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:min-w-11 pointer-coarse:leading-11 max-sm:first:-ml-1.5"
    >
      <CapAligned height={12}>
        <Plus className="h-3 w-3" strokeWidth={1.5} />
      </CapAligned>
      {text}
    </button>
  );
}

/**
 * A labelled row of chips: the label on the left, chips and Add on the right.
 * Every first line, the label's included, centers 1px lower than its line
 * (the chip's border): 13px down, 23px on touch, where chips are 44px.
 * On a phone the label sits over the chips, as a field's label does, so the
 * chips take the full width (a 112px label column left them 136px at 320)
 */
export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 max-sm:flex-col">
      <span className="w-28 shrink-0 pt-px text-xs leading-6 text-fg-secondary pointer-coarse:leading-11 max-sm:w-auto max-sm:pt-0 max-sm:font-medium max-sm:leading-5 max-sm:pointer-coarse:leading-5">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-1.5 max-sm:w-full max-sm:flex-none">{children}</div>
    </div>
  );
}

/**
 * One record chosen by search (a supplier, a shop): its chip with Remove,
 * or "Choose" to search, with Create when the search allows it.
 */
export function SingleChoiceField({
  label,
  value,
  onChange,
  search,
  onCreate,
  placeholder,
}: {
  label: string;
  value: { id: string; label: string } | null;
  onChange: (value: { id: string; label: string } | null) => void;
  search: (query: string) => Promise<PickerChoice[]>;
  onCreate?: (name: string) => Promise<PickerChoice>;
  placeholder: string;
}) {
  const add = useAddButton();
  return (
    <FieldRow label={label}>
      {value ? (
        <span className={CHIP}>
          <span className={CHIP_NAME}>{value.label}</span>
          <RemoveButton label={`Remove ${value.label}`} onClick={() => onChange(null)} />
        </span>
      ) : add.open ? (
        <SearchPicker
          label={`Search: ${label.toLowerCase()}`}
          placeholder={placeholder}
          search={search}
          onCreate={onCreate}
          onPick={(choice) => {
            add.close();
            onChange({ id: choice.id, label: choice.label });
          }}
          onClose={add.close}
        />
      ) : (
        <AddButton
          label={`Choose: ${label.toLowerCase()}`}
          text="Choose"
          onClick={() => add.setOpen(true)}
          buttonRef={add.button}
        />
      )}
    </FieldRow>
  );
}

// ── Searches ─────────────────────────────────────────────────────────────────

/** How an organization's roles read beside its name in a search */
const ROLE_HINTS: Record<OrganizationRole, string> = {
  publisher: "publisher",
  imprint: "imprint",
  perfume_house: "perfume house",
  brand: "brand",
  manufacturer: "manufacturer",
  retailer: "retailer",
  production_company: "production company",
  distribution_company: "distributor",
  museum: "museum",
  gallery: "gallery",
};

/**
 * An organization search, with "Create" making one with `role`. With
 * `roles`, it offers only organizations with one of them (a perfume's house
 * never suggests a publisher); without, it searches every organization.
 */
export function useOrganizationSearch(
  role: OrganizationRole,
  roles?: readonly OrganizationRole[],
) {
  const key = roles?.join(",") ?? "";
  const search = useCallback(
    async (query: string): Promise<PickerChoice[]> =>
      (
        await getOrganizations({
          query,
          roles: key ? (key.split(",") as OrganizationRole[]) : undefined,
          limit: 8,
        })
      ).rows.map((o) => ({
        id: o.id,
        label: o.name,
        hint: o.roles.flatMap((r) => (ROLE_HINTS[r] ? [ROLE_HINTS[r]] : [])).join(", ") || null,
      })),
    [key],
  );
  const create = useCallback(
    async (name: string): Promise<PickerChoice> => {
      const created = await saveOrganization({ name, roles: [role] });
      if (!created) throw new Error("Could not create the organization");
      return { id: created.id, label: created.name };
    },
    [role],
  );
  return { search, create };
}

/** A person search, with "Create" making a person of `domain` */
export function usePersonSearch(domain: WorkKind) {
  const search = useCallback(
    async (query: string): Promise<PickerChoice[]> =>
      (await getPeople({ query, limit: 8 })).rows.map((p) => ({
        id: p.id,
        label: p.name,
        hint:
          p.birthYear || p.deathYear
            ? `${p.birthYear ?? "?"}–${p.deathYear ?? ""}`
            : null,
      })),
    [],
  );
  const create = useCallback(async (name: string): Promise<PickerChoice> => {
    const created = await createPerson({ name, domains: [domain] });
    return { id: created.id, label: name };
  }, [domain]);
  return { search, create };
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

export interface TermEntry {
  id: string;
  name: string;
  parentName: string | null;
}

/** Terms of one vocabulary (perfume families, film genres), with Create */
export function TermListField({
  label,
  family,
  value,
  onChange,
}: {
  label: string;
  family: { slug: string; name: string };
  value: TermEntry[];
  onChange: (value: TermEntry[]) => void;
}) {
  const add = useAddButton();
  return (
    <FieldRow label={label}>
      {value.map((term) => (
        <span key={term.id} className={CHIP}>
          <span className={CHIP_NAME}>
            {term.parentName && <span>{term.parentName} › </span>}
            {term.name}
          </span>
          <RemoveButton
            label={`Remove ${term.name} from ${label.toLowerCase()}`}
            onClick={() => onChange(value.filter((t) => t.id !== term.id))}
          />
        </span>
      ))}
      {add.open ? (
        <TaxonomyItemSearch
          family={family}
          exclude={new Set(value.map((t) => t.id))}
          onPick={(item) => {
            add.close();
            onChange([...value, item]);
          }}
          onClose={add.close}
        />
      ) : (
        <AddButton
          label={`Add to ${label.toLowerCase()}`}
          onClick={() => add.setOpen(true)}
          buttonRef={add.button}
        />
      )}
    </FieldRow>
  );
}
