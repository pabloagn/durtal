"use client";

import {
  AddButton,
  CHIP,
  FieldRow,
  RemoveButton,
  useAddButton,
  usePersonSearch,
} from "@/components/catalogue/record-fields";
import { SearchPicker } from "@/components/catalogue/search-picker";
import type { Attribution } from "@/lib/catalogue/credits";
import { painterName, type PainterEntry } from "@/lib/catalogue/painting-labels";

export type { PainterEntry };

/** The attributions a painter can carry, as the chip's menu lists them */
const ATTRIBUTION_CHOICES: { value: Attribution; label: string }[] = [
  { value: "unspecified", label: "By" },
  { value: "confirmed", label: "Confirmed" },
  { value: "attributed", label: "Attributed to" },
  { value: "uncertain", label: "Possibly by" },
];

let nextKey = 0;
/** A key for a painter added in the form */
export function painterKey() {
  nextKey += 1;
  return `new-${nextKey}`;
}

/**
 * The painters of a work or of one object, in order, each with how sure the
 * attribution is. "Unknown" records an unnamed hand instead of leaving the
 * list empty.
 */
export function PaintersField({
  label = "Painters",
  value,
  onChange,
}: {
  label?: string;
  value: PainterEntry[];
  onChange: (value: PainterEntry[]) => void;
}) {
  const add = useAddButton();
  const { search, create } = usePersonSearch("painting");
  return (
    <FieldRow label={label}>
      {value.map((entry, index) => (
        <span key={entry.key} className={CHIP}>
          {entry.personId && (
            <select
              aria-label={`Attribution of ${painterName(entry)}`}
              value={entry.attribution}
              onChange={(e) =>
                onChange(
                  value.map((c, i) =>
                    i === index ? { ...c, attribution: e.target.value as Attribution } : c,
                  ),
                )
              }
              className="h-5 rounded-sm border border-transparent bg-transparent px-0.5 text-xs leading-5 text-fg-secondary hover:border-glass-border focus:border-accent-rose focus:outline-none"
            >
              {ATTRIBUTION_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          )}
          <span className={`truncate ${entry.personId ? "" : "italic"}`}>
            {painterName(entry)}
          </span>
          <RemoveButton
            label={`Remove ${painterName(entry)}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </span>
      ))}
      {add.open ? (
        <SearchPicker
          label="Search painters"
          placeholder="Search people..."
          search={search}
          onCreate={create}
          exclude={new Set(value.flatMap((c) => (c.personId ? [c.personId] : [])))}
          onPick={(choice) => {
            add.close();
            onChange([
              ...value,
              {
                key: painterKey(),
                personId: choice.id,
                name: choice.label,
                creditedAs: null,
                attribution: "unspecified",
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
                    key: painterKey(),
                    personId: null,
                    name: null,
                    creditedAs: null,
                    attribution: "unknown",
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
