"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import {
  DATE_DRAFT_KINDS,
  DATE_DRAFT_LABELS,
  dateDraft,
  dateDraftValue,
  type DateDraft,
  type DateDraftKind,
} from "@/lib/catalogue/date-draft";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, i) => ({ value: String(i + 1), label }));

const ERAS = [
  { value: "ce", label: "AD" },
  { value: "bce", label: "BC" },
];

/**
 * A date as precise as it is known: not recorded, unknown, a year, a month,
 * a day or a span of years, any of them approximate ("c. 1925"). Each change
 * reports the date and, while the fields do not make one, why not; the form
 * keeps its Save disabled on an error. Reset it with a new `key`.
 */
export function CatalogueDateField({
  label,
  value,
  onChange,
  allowBce = false,
  kinds = DATE_DRAFT_KINDS,
  allowApproximate = true,
}: {
  label: string;
  value: CatalogueDateInput | null;
  onChange: (value: CatalogueDateInput | null, error: string | null) => void;
  /** Offer BC years (paintings); perfumes and films start at year 1 */
  allowBce?: boolean;
  /** The precisions offered; readings take unknown, year, month and day */
  kinds?: readonly DateDraftKind[];
  allowApproximate?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<DateDraft>(() => dateDraft(value));
  const { error } = dateDraftValue(draft);
  // An error shows once the person has typed something for this kind
  const [touched, setTouched] = useState(false);

  function update(patch: Partial<DateDraft>) {
    // An edited date no longer matches its stored label
    const next = { ...draft, ...patch, label: null };
    setDraft(next);
    setTouched(true);
    const result = dateDraftValue(next);
    onChange(result.value, result.error);
  }

  const kind = draft.kind;
  const dated = kind !== "none" && kind !== "unknown";
  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className="type-label mb-1.5 block">{label}</legend>
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-40">
          <Select
            id={`${id}-kind`}
            ariaLabel={`${label}: how precise`}
            value={kind}
            onChange={(e) =>
              update({ kind: e.target.value as DateDraftKind })
            }
            options={kinds.map((k) => ({
              value: k,
              label: DATE_DRAFT_LABELS[k],
            }))}
          />
        </div>
        {dated && (
          <div className="w-20">
            <Input
              aria-label={kind === "range" ? `${label}: first year` : `${label}: year`}
              inputMode="numeric"
              placeholder="Year"
              value={draft.year}
              maxLength={6}
              onChange={(e) => update({ year: e.target.value })}
            />
          </div>
        )}
        {dated && allowBce && (
          <div className="w-20">
            <Select
              ariaLabel={`${label}: era`}
              value={draft.bce ? "bce" : "ce"}
              onChange={(e) => update({ bce: e.target.value === "bce" })}
              options={ERAS}
            />
          </div>
        )}
        {(kind === "month" || kind === "day") && (
          <div className="w-32">
            <Select
              id={`${id}-month`}
              ariaLabel={`${label}: month`}
              value={draft.month}
              placeholder="Month"
              onChange={(e) => update({ month: e.target.value })}
              options={MONTHS}
            />
          </div>
        )}
        {kind === "day" && (
          <div className="w-16">
            <Input
              aria-label={`${label}: day`}
              inputMode="numeric"
              placeholder="Day"
              value={draft.day}
              maxLength={2}
              onChange={(e) => update({ day: e.target.value })}
            />
          </div>
        )}
        {kind === "range" && (
          // "to" and the last year wrap together
          <div className="flex items-start gap-2">
            <span className="text-sm leading-8 text-fg-secondary" aria-hidden>
              to
            </span>
            <div className="w-20">
              <Input
                aria-label={`${label}: last year`}
                inputMode="numeric"
                placeholder="Year"
                value={draft.endYear}
                maxLength={6}
                onChange={(e) => update({ endYear: e.target.value })}
              />
            </div>
            {allowBce && (
              <div className="w-20">
                <Select
                  ariaLabel={`${label}: era of the last year`}
                  value={draft.endBce ? "bce" : "ce"}
                  onChange={(e) => update({ endBce: e.target.value === "bce" })}
                  options={ERAS}
                />
              </div>
            )}
          </div>
        )}
        {dated && allowApproximate && (
          <label className="flex h-8 items-center gap-2 text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={draft.approximate}
              onChange={(e) => update({ approximate: e.target.checked })}
              className="rounded-sm"
            />
            Approximate
          </label>
        )}
      </div>
      {touched && error && (
        <p className="text-xs text-accent-red-text" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
