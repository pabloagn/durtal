"use client";

import { Select } from "@/components/ui/select";
import {
  AddButton,
  CREDIT_CHIP,
  CREDIT_CHIP_NAME,
  FieldRow,
  useAddButton,
  usePersonSearch,
} from "@/components/catalogue/record-fields";
import { CreditRowControls, moveRow } from "@/components/shared/credit-row-controls";
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
 * The painters of a work or of one object, in order (Move up and down,
 * SLN-1131), each with how sure the attribution is. "Unknown" records an unnamed hand instead of leaving the
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
        <span key={entry.key} data-credit-row="" className={CREDIT_CHIP}>
          {entry.personId && (
            <Select
              compact
              ariaLabel={`Attribution of ${painterName(entry)}`}
              value={entry.attribution}
              options={ATTRIBUTION_CHOICES}
              onChange={(e) =>
                onChange(
                  value.map((c, i) =>
                    i === index ? { ...c, attribution: e.target.value as Attribution } : c,
                  ),
                )
              }
            />
          )}
          <span className={`${CREDIT_CHIP_NAME} ${entry.personId ? "" : "italic"}`}>
            {painterName(entry)}
          </span>
          <CreditRowControls
            name={painterName(entry)}
            first={index === 0}
            last={index === value.length - 1}
            onMove={(step) => onChange(moveRow(value, index, step))}
            onRemove={() => onChange(value.filter((_, i) => i !== index))}
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
            <AddButton
              label="Add an unknown painter"
              text="Unknown"
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
            />
          )}
        </>
      )}
    </FieldRow>
  );
}
