"use client";

import { useCallback } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  AddButton,
  CHIP,
  FieldRow,
  RemoveButton,
  useAddButton,
  useOrganizationSearch,
  usePersonSearch,
} from "@/components/catalogue/record-fields";
import { SearchPicker, type PickerChoice } from "@/components/catalogue/search-picker";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  FILM_CREDIT_ROLES,
  filmCreditName,
  type FilmCreditEntry,
  type FilmCreditRole,
} from "@/lib/catalogue/film-labels";

export type { FilmCreditEntry };

// ── Fixed lists: countries and languages ─────────────────────────────────────

export interface Choice {
  id: string;
  name: string;
}

/** A local search over a fixed list, by the start of any word first */
export function useListSearch(list: Choice[]) {
  return useCallback(
    async (query: string): Promise<PickerChoice[]> => {
      const q = query.toLowerCase();
      const found = q
        ? list.filter((c) => c.name.toLowerCase().includes(q))
        : list;
      const starts = (c: Choice) =>
        c.name.toLowerCase().startsWith(q) ||
        c.name.toLowerCase().includes(` ${q}`);
      return [...found.filter(starts), ...found.filter((c) => !starts(c))]
        .slice(0, 12)
        .map((c) => ({ id: c.id, label: c.name }));
    },
    [list],
  );
}

/**
 * Countries or languages in credited order, chosen from a fixed list. The
 * first is the main one.
 */
export function ChoiceListField({
  label,
  noun,
  choices,
  value,
  onChange,
}: {
  label: string;
  /** "countries": the search's name */
  noun: string;
  choices: Choice[];
  value: Choice[];
  onChange: (value: Choice[]) => void;
}) {
  const add = useAddButton();
  const search = useListSearch(choices);
  return (
    <FieldRow label={label}>
      {value.map((entry) => (
        <span key={entry.id} className={CHIP}>
          <span className="truncate">{entry.name}</span>
          <RemoveButton
            label={`Remove ${entry.name}`}
            onClick={() => onChange(value.filter((c) => c.id !== entry.id))}
          />
        </span>
      ))}
      {add.open ? (
        <SearchPicker
          label={`Search ${noun}`}
          placeholder={`Search ${noun}...`}
          search={search}
          exclude={new Set(value.map((c) => c.id))}
          onPick={(choice) => {
            add.close();
            onChange([...value, { id: choice.id, name: choice.label }]);
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

// ── Production companies ─────────────────────────────────────────────────────

export interface CompanyEntry {
  organizationId: string;
  name: string;
  sourceRecordId: string | null;
}

/** The production companies, in credited order; each gets the role on save */
export function CompaniesField({
  value,
  onChange,
}: {
  value: CompanyEntry[];
  onChange: (value: CompanyEntry[]) => void;
}) {
  const add = useAddButton();
  const { search, create } = useOrganizationSearch("production_company", ["production_company"]);
  return (
    <FieldRow label="Production">
      {value.map((entry) => (
        <span key={entry.organizationId} className={CHIP}>
          <span className="truncate">{entry.name}</span>
          <RemoveButton
            label={`Remove ${entry.name}`}
            onClick={() =>
              onChange(value.filter((o) => o.organizationId !== entry.organizationId))
            }
          />
        </span>
      ))}
      {add.open ? (
        <SearchPicker
          label="Search production companies"
          placeholder="Search companies..."
          search={search}
          onCreate={create}
          exclude={new Set(value.map((o) => o.organizationId))}
          onPick={(choice) => {
            add.close();
            onChange([
              ...value,
              { organizationId: choice.id, name: choice.label, sourceRecordId: null },
            ]);
          }}
          onClose={add.close}
        />
      ) : (
        <AddButton
          label="Add a production company"
          onClick={() => add.setOpen(true)}
          buttonRef={add.button}
        />
      )}
    </FieldRow>
  );
}

// ── Cast and crew ────────────────────────────────────────────────────────────

/** The credits a group of the editor holds, and the roles it offers */
export const CREDIT_GROUPS = [
  {
    key: "direction",
    title: "Direction and writing",
    roles: ["film.director", "film.screenwriter", "film.story"],
  },
  { key: "cast", title: "Cast", roles: ["film.cast"] },
  {
    key: "crew",
    title: "Crew",
    roles: [
      "film.producer",
      "film.cinematographer",
      "film.editor",
      "film.composer",
      "film.production_designer",
      "film.costume_designer",
    ],
  },
] as const satisfies readonly { key: string; title: string; roles: readonly FilmCreditRole[] }[];

let nextKey = 0;
/** A key for a credit added in the form */
export function creditKey() {
  nextKey += 1;
  return `new-${nextKey}`;
}

const SMALL_INPUT =
  "h-7 min-w-0 rounded-sm border border-glass-border bg-bg-primary/80 px-2 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent-primary focus:outline-none";
const ICON_BUTTON =
  "flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-primary";

function CreditRow({
  entry,
  roles,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  entry: FilmCreditEntry;
  roles: readonly FilmCreditRole[];
  first: boolean;
  last: boolean;
  onChange: (entry: FilmCreditEntry) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const name = filmCreditName({
    name: entry.name,
    creditedAs: entry.personId ? null : entry.creditedAs.trim() || null,
    attribution: entry.attribution,
  });
  const cast = entry.roleId === "film.cast";
  return (
    <li className="rounded-sm border border-glass-border bg-bg-secondary/40 px-2.5 py-2">
      <div className="flex items-start gap-2 text-sm">
        <span
          className={`min-w-0 flex-1 truncate ${entry.personId ? "text-fg-primary" : "italic text-fg-secondary"}`}
        >
          {name}
        </span>
        {roles.length > 1 && (
          <select
            aria-label={`Role of ${name}`}
            value={entry.roleId}
            onChange={(e) => onChange({ ...entry, roleId: e.target.value as FilmCreditRole })}
            className="h-6 shrink-0 rounded-sm border border-glass-border bg-transparent px-1 text-xs text-fg-secondary hover:border-fg-muted focus:border-accent-primary focus:outline-none"
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {FILM_CREDIT_ROLES[role].one}
              </option>
            ))}
          </select>
        )}
        <CapAligned height={24}>
          <div className="flex items-center">
            <button
              type="button"
              aria-label={`Move ${name} up`}
              data-tooltip="Move up"
              disabled={first}
              onClick={() => onMove(-1)}
              className={ICON_BUTTON}
            >
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label={`Move ${name} down`}
              data-tooltip="Move down"
              disabled={last}
              onClick={() => onMove(1)}
              className={ICON_BUTTON}
            >
              <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label={`Remove ${name}`}
              data-tooltip="Remove"
              onClick={onRemove}
              className={ICON_BUTTON}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </CapAligned>
      </div>
      <div className={`mt-1.5 grid gap-1.5 ${cast ? "sm:grid-cols-2" : ""}`}>
        <input
          type="text"
          aria-label={`${name}: credited as`}
          value={entry.creditedAs}
          maxLength={300}
          onChange={(e) => onChange({ ...entry, creditedAs: e.target.value })}
          placeholder={entry.personId ? "Credited as (when it differs)" : "Credited name, if known"}
          className={SMALL_INPUT}
        />
        {cast && (
          <input
            type="text"
            aria-label={`${name}: characters`}
            value={entry.characters}
            maxLength={2000}
            onChange={(e) => onChange({ ...entry, characters: e.target.value })}
            placeholder="Character; several split by /"
            className={SMALL_INPUT}
          />
        )}
      </div>
    </li>
  );
}

function CreditGroup({
  title,
  roles,
  value,
  onChange,
}: {
  title: string;
  roles: readonly FilmCreditRole[];
  value: FilmCreditEntry[];
  onChange: (value: FilmCreditEntry[]) => void;
}) {
  const add = useAddButton();
  const { search, create } = usePersonSearch("film");
  const newEntry = (fields: Partial<FilmCreditEntry>): FilmCreditEntry => ({
    key: creditKey(),
    personId: null,
    name: null,
    roleId: roles[0],
    creditedAs: "",
    characters: "",
    attribution: "unspecified",
    notes: null,
    ...fields,
  });
  const move = (index: number, step: -1 | 1) => {
    const next = [...value];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    onChange(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="type-label mb-1.5">{title}</legend>
      {value.length > 0 && (
        <ol className="space-y-1.5">
          {value.map((entry, index) => (
            <CreditRow
              key={entry.key}
              entry={entry}
              roles={roles}
              first={index === 0}
              last={index === value.length - 1}
              onChange={(changed) =>
                onChange(value.map((e, i) => (i === index ? changed : e)))
              }
              onMove={(step) => move(index, step)}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-start gap-1.5">
        {add.open ? (
          <SearchPicker
            label={`Search people: ${title.toLowerCase()}`}
            placeholder="Search people..."
            search={search}
            onCreate={create}
            onPick={(choice) => {
              add.close();
              onChange([...value, newEntry({ personId: choice.id, name: choice.label })]);
            }}
            onClose={add.close}
          />
        ) : (
          <>
            <AddButton
              label={`Add a person: ${title.toLowerCase()}`}
              text="Add person"
              onClick={() => add.setOpen(true)}
              buttonRef={add.button}
            />
            <button
              type="button"
              onClick={() => onChange([...value, newEntry({ attribution: "unknown" })])}
              className="rounded-sm px-1.5 text-xs leading-6 text-fg-secondary transition-colors hover:text-fg-primary"
            >
              Unknown
            </button>
          </>
        )}
      </div>
    </fieldset>
  );
}

/**
 * The cast and crew in billing order, in three groups: direction and
 * writing, cast, crew. A person may hold several roles and play several
 * characters. "Unknown" records that someone held the role without a name;
 * a credited name keeps the name on screen when it differs from the person's.
 */
export function CreditsEditor({
  value,
  onChange,
}: {
  value: FilmCreditEntry[];
  onChange: (value: FilmCreditEntry[]) => void;
}) {
  return (
    <div className="space-y-5">
      {CREDIT_GROUPS.map((group) => {
        const roles: readonly FilmCreditRole[] = group.roles;
        const inGroup = value.filter((c) => roles.includes(c.roleId));
        return (
          <CreditGroup
            key={group.key}
            title={group.title}
            roles={roles}
            value={inGroup}
            onChange={(next) =>
              // The groups keep their order: direction, cast, crew
              onChange(
                CREDIT_GROUPS.flatMap((g) => {
                  const groupRoles: readonly FilmCreditRole[] = g.roles;
                  return g.key === group.key
                    ? next
                    : value.filter((c) => groupRoles.includes(c.roleId));
                }),
              )
            }
          />
        );
      })}
    </div>
  );
}
