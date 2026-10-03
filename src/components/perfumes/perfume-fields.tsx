"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { TaxonomyItemSearch } from "@/components/taxonomy/taxonomy-assignments";
import { getOrganizations, saveOrganization } from "@/lib/actions/organizations";
import { createPerson, getPeople } from "@/lib/actions/people";
import type { Attribution } from "@/lib/catalogue/credits";
import type { OrganizationRole } from "@/lib/catalogue/organizations";
import {
  NOTE_POSITION_LABELS,
  type NotePosition,
} from "@/lib/catalogue/perfume-labels";
import { SearchPicker, type PickerChoice } from "./search-picker";

// ── Shared pieces ────────────────────────────────────────────────────────────

const CHIP =
  "inline-flex max-w-full items-start gap-1 rounded-sm border border-glass-border bg-bg-secondary/60 py-0.5 pl-2 pr-1 text-xs leading-5 text-fg-secondary";

/** The remove button of a chip, on the cap-height center of its text */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <CapAligned height={16}>
      <button
        type="button"
        aria-label={label}
        data-tooltip={label}
        onClick={onClick}
        className="flex h-4 w-4 items-center justify-center rounded-sm text-fg-muted transition-colors hover:text-fg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-rose"
      >
        <X className="h-3 w-3" strokeWidth={1.5} />
      </button>
    </CapAligned>
  );
}

/** "Add" beside a field's chips; focus comes back to it after a pick or Escape */
function useAddButton() {
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

function AddButton({
  label,
  text = "Add",
  onClick,
  buttonRef,
}: {
  label: string;
  text?: string;
  onClick: () => void;
  buttonRef: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-start gap-1 rounded-sm px-1.5 text-xs leading-6 text-fg-secondary transition-colors hover:text-fg-primary"
    >
      <CapAligned height={12}>
        <Plus className="h-3 w-3" strokeWidth={1.5} />
      </CapAligned>
      {text}
    </button>
  );
}

/** A labelled row of chips: the label on the left, chips and Add on the right */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
      <span className="w-28 shrink-0 text-xs leading-6 text-fg-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-1.5">{children}</div>
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
          <span className="truncate">{value.label}</span>
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

// ── Organizations ────────────────────────────────────────────────────────────

const ROLE_HINTS: Partial<Record<OrganizationRole, string>> = {
  perfume_house: "perfume house",
  brand: "brand",
  manufacturer: "manufacturer",
  retailer: "retailer",
  publisher: "publisher",
  imprint: "imprint",
};

/** An organization search, with "Create" making one with `role` */
export function useOrganizationSearch(role: OrganizationRole) {
  const search = useCallback(
    async (query: string): Promise<PickerChoice[]> =>
      (await getOrganizations({ query, limit: 8 })).rows.map((o) => ({
        id: o.id,
        label: o.name,
        hint: o.roles.flatMap((r) => (ROLE_HINTS[r] ? [ROLE_HINTS[r]] : [])).join(", ") || null,
      })),
    [],
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

export const PERFUME_ORGANIZATION_ROLE_LABELS = {
  perfume_house: "House",
  brand: "Brand",
  manufacturer: "Manufacturer",
} as const;
export type PerfumeOrganizationRole = keyof typeof PERFUME_ORGANIZATION_ROLE_LABELS;

export interface OrganizationEntry {
  organizationId: string;
  name: string;
  role: PerfumeOrganizationRole;
  sourceRecordId: string | null;
}

/**
 * The houses, brands and manufacturers of a perfume, in order. A pick is a
 * house; its role can be changed. Saving gives each organization the role.
 */
export function OrganizationRolesField({
  value,
  onChange,
}: {
  value: OrganizationEntry[];
  onChange: (value: OrganizationEntry[]) => void;
}) {
  const add = useAddButton();
  const { search, create } = useOrganizationSearch("perfume_house");
  const taken = (organizationId: string, role: string, except: number) =>
    value.some((o, i) => i !== except && o.organizationId === organizationId && o.role === role);
  return (
    <FieldRow label="House">
      {value.map((entry, index) => (
        <span key={`${entry.organizationId}:${entry.role}`} className={CHIP}>
          <span className="truncate">{entry.name}</span>
          <select
            aria-label={`Role of ${entry.name}`}
            value={entry.role}
            onChange={(e) => {
              const role = e.target.value as PerfumeOrganizationRole;
              if (taken(entry.organizationId, role, index)) return;
              onChange(value.map((o, i) => (i === index ? { ...o, role } : o)));
            }}
            className="h-5 rounded-sm border border-transparent bg-transparent px-0.5 text-xs leading-5 text-fg-secondary hover:border-glass-border focus:border-accent-rose focus:outline-none"
          >
            {Object.entries(PERFUME_ORGANIZATION_ROLE_LABELS).map(([role, label]) => (
              <option
                key={role}
                value={role}
                disabled={taken(entry.organizationId, role, index)}
              >
                {label}
              </option>
            ))}
          </select>
          <RemoveButton
            label={`Remove ${entry.name}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </span>
      ))}
      {add.open ? (
        <SearchPicker
          label="Search houses and brands"
          placeholder="Search houses..."
          search={search}
          onCreate={create}
          exclude={new Set(value.filter((o) => o.role === "perfume_house").map((o) => o.organizationId))}
          onPick={(choice) => {
            add.close();
            const role: PerfumeOrganizationRole = taken(choice.id, "perfume_house", -1) ? "brand" : "perfume_house";
            onChange([
              ...value,
              { organizationId: choice.id, name: choice.label, role, sourceRecordId: null },
            ]);
          }}
          onClose={add.close}
        />
      ) : (
        <AddButton
          label="Add a house or brand"
          onClick={() => add.setOpen(true)}
          buttonRef={add.button}
        />
      )}
    </FieldRow>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

/** A person search, with "Create" making a perfumer */
export function usePersonSearch() {
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
    const created = await createPerson({ name, domains: ["perfume"] });
    return { id: created.id, label: name };
  }, []);
  return { search, create };
}

export const PERFUME_CREDIT_ROLE_LABELS = {
  "perfume.perfumer": "Perfumer",
  "perfume.creative_director": "Creative director",
} as const;
export type PerfumeCreditRole = keyof typeof PERFUME_CREDIT_ROLE_LABELS;

export interface CreditEntry {
  /** The stored credit, kept across edits */
  id?: string;
  personId: string | null;
  name: string | null;
  creditedAs: string | null;
  attribution: Attribution;
  /** A fragrance credit; formulation perfumers have none */
  roleId?: PerfumeCreditRole;
  sourceRecordId?: string | null;
  notes?: string | null;
}

/** What a credit shows: the person, the name it was credited as, or why none */
export function creditName(entry: CreditEntry) {
  return (
    entry.name ??
    entry.creditedAs ??
    (entry.attribution === "anonymous" ? "Anonymous" : "Unknown perfumer")
  );
}

/**
 * The people of a fragrance or a formulation, in order. With `roles`, each
 * is a perfumer or a creative director. "Unknown" records that a perfumer
 * exists without a name, instead of leaving the list empty.
 */
export function CreditListField({
  label,
  value,
  onChange,
  roles = false,
}: {
  label: string;
  value: CreditEntry[];
  onChange: (value: CreditEntry[]) => void;
  roles?: boolean;
}) {
  const add = useAddButton();
  const { search, create } = usePersonSearch();
  return (
    <FieldRow label={label}>
      {value.map((entry, index) => (
        <span key={entry.id ?? `${entry.personId ?? "unknown"}:${index}`} className={CHIP}>
          <span
            className={`truncate ${entry.personId ? "" : "italic"}`}
          >
            {creditName(entry)}
          </span>
          {roles && (
            <select
              aria-label={`Role of ${creditName(entry)}`}
              value={entry.roleId ?? "perfume.perfumer"}
              onChange={(e) =>
                onChange(
                  value.map((c, i) =>
                    i === index ? { ...c, roleId: e.target.value as PerfumeCreditRole } : c,
                  ),
                )
              }
              className="h-5 rounded-sm border border-transparent bg-transparent px-0.5 text-xs leading-5 text-fg-secondary hover:border-glass-border focus:border-accent-rose focus:outline-none"
            >
              {Object.entries(PERFUME_CREDIT_ROLE_LABELS).map(([role, roleLabel]) => (
                <option key={role} value={role}>
                  {roleLabel}
                </option>
              ))}
            </select>
          )}
          <RemoveButton
            label={`Remove ${creditName(entry)}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </span>
      ))}
      {add.open ? (
        <SearchPicker
          label="Search people"
          placeholder="Search people..."
          search={search}
          onCreate={create}
          exclude={new Set(value.flatMap((c) => (c.personId ? [c.personId] : [])))}
          onPick={(choice) => {
            add.close();
            onChange([
              ...value,
              {
                personId: choice.id,
                name: choice.label,
                creditedAs: null,
                attribution: "unspecified",
                ...(roles ? { roleId: "perfume.perfumer" as const } : {}),
              },
            ]);
          }}
          onClose={add.close}
        />
      ) : (
        <>
          <AddButton
            label={`Add to ${label.toLowerCase()}`}
            onClick={() => add.setOpen(true)}
            buttonRef={add.button}
          />
          {!value.some((c) => !c.personId) && (
            <button
              type="button"
              onClick={() =>
                onChange([
                  ...value,
                  {
                    personId: null,
                    name: null,
                    creditedAs: null,
                    attribution: "unknown",
                    ...(roles ? { roleId: "perfume.perfumer" as const } : {}),
                  },
                ])
              }
              className="rounded-sm px-1.5 text-xs leading-6 text-fg-secondary transition-colors hover:text-fg-primary"
            >
              Unknown
            </button>
          )}
        </>
      )}
    </FieldRow>
  );
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

export interface TermEntry {
  id: string;
  name: string;
  parentName: string | null;
}

/** Terms of one vocabulary (perfume families, accords), with Create */
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
          <span className="truncate">
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

// ── Note pyramid ─────────────────────────────────────────────────────────────

export interface NoteEntry {
  itemId: string;
  name: string;
  parentName: string | null;
  position: NotePosition;
  sourceRecordId: string | null;
}

export const NOTES_FAMILY = { slug: "perfume-notes", name: "Perfume notes" };

const POSITIONS: NotePosition[] = ["top", "heart", "base", "unspecified"];

function PositionRow({
  position,
  notes,
  onAdd,
  onRemove,
}: {
  position: NotePosition;
  notes: NoteEntry[];
  onAdd: (note: TermEntry) => void;
  onRemove: (note: NoteEntry) => void;
}) {
  const add = useAddButton();
  const label =
    position === "unspecified" ? "Unplaced" : `${NOTE_POSITION_LABELS[position]} notes`;
  return (
    <FieldRow label={label}>
      {notes.map((note) => (
        <span key={note.itemId} className={CHIP}>
          <span className="truncate">{note.name}</span>
          <RemoveButton
            label={`Remove ${note.name} from ${label.toLowerCase()}`}
            onClick={() => onRemove(note)}
          />
        </span>
      ))}
      {add.open ? (
        <TaxonomyItemSearch
          family={NOTES_FAMILY}
          exclude={new Set(notes.map((n) => n.itemId))}
          onPick={(item) => {
            add.close();
            onAdd(item);
          }}
          onClose={add.close}
        />
      ) : (
        <AddButton
          label={`Add a ${position === "unspecified" ? "note without a place" : `${position} note`}`}
          onClick={() => add.setOpen(true)}
          buttonRef={add.button}
        />
      )}
    </FieldRow>
  );
}

/**
 * The note pyramid as rows: top, heart, base, and notes without a place.
 * A note can sit in more than one row; within a row the order is kept.
 * Sources already recorded for a note stay with it.
 */
export function NotePyramidEditor({
  value,
  onChange,
}: {
  value: NoteEntry[];
  onChange: (value: NoteEntry[]) => void;
}) {
  return (
    <div className="space-y-2">
      {POSITIONS.map((position) => (
        <PositionRow
          key={position}
          position={position}
          notes={value.filter((n) => n.position === position)}
          onAdd={(item) =>
            onChange([
              ...value,
              {
                itemId: item.id,
                name: item.name,
                parentName: item.parentName,
                position,
                sourceRecordId: null,
              },
            ])
          }
          onRemove={(note) =>
            onChange(
              value.filter(
                (n) => !(n.itemId === note.itemId && n.position === note.position),
              ),
            )
          }
        />
      ))}
    </div>
  );
}
