"use client";

import {
  AddButton,
  CHIP,
  FieldRow,
  RemoveButton,
  useAddButton,
  useOrganizationSearch,
  usePersonSearch,
  type TermEntry,
} from "@/components/catalogue/record-fields";
import { SearchPicker } from "@/components/catalogue/search-picker";
import { TaxonomyItemSearch } from "@/components/taxonomy/taxonomy-assignments";
import type { Attribution } from "@/lib/catalogue/credits";
import { PERFUME_ORGANIZATION_ROLES } from "@/lib/catalogue/perfumes";
import {
  NOTE_POSITION_LABELS,
  type NotePosition,
} from "@/lib/catalogue/perfume-labels";

// ── Organizations ────────────────────────────────────────────────────────────

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
  const { search, create } = useOrganizationSearch("perfume_house", PERFUME_ORGANIZATION_ROLES);
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
            className="h-5 rounded-sm border border-transparent bg-transparent px-0.5 text-xs leading-5 text-fg-secondary hover:border-glass-border focus:border-accent-primary focus:outline-none"
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
  const { search, create } = usePersonSearch("perfume");
  return (
    <FieldRow label={label}>
      {value.map((entry, index) => (
        <span key={entry.id ?? `${entry.personId ?? "unknown"}:${index}`} className={`${CHIP} pointer-coarse:leading-11`}>
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
              className="h-5 rounded-sm border border-transparent bg-transparent px-0.5 text-xs leading-5 text-fg-secondary hover:border-glass-border focus:border-accent-primary focus:outline-none pointer-coarse:h-11 pointer-coarse:min-w-11"
            >
              {Object.entries(PERFUME_CREDIT_ROLE_LABELS).map(([role, roleLabel]) => (
                <option key={role} value={role}>
                  {roleLabel}
                </option>
              ))}
            </select>
          )}
          <RemoveButton
            touchTarget
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
              className="rounded-sm px-1.5 text-xs leading-6 text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              Unknown
            </button>
          )}
        </>
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
