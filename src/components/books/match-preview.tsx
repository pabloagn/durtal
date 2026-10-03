"use client";

import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  previewMatchHouses,
  type HouseFields,
  type MatchHouse,
  type MatchHouses,
  type MatchPreview,
} from "@/lib/actions/match";
import {
  MATCH_FIELD_LABEL,
  type MatchField,
  type MatchRow,
  type MatchValue,
} from "@/lib/match/plan";
import { languageName } from "@/lib/utils/language";
import { bindingLabel } from "@/lib/utils/binding";

const HOUSE_FIELDS: (keyof HouseFields)[] = [
  "publisher",
  "imprint",
  "isbn13",
  "isbn10",
];

function shown(field: MatchField, value: MatchValue) {
  if (value === null) return null;
  if (field === "language") return languageName(String(value));
  if (field === "binding") return bindingLabel(String(value));
  return String(value);
}

function Value({
  row,
  value,
  coverUrl,
}: {
  row: MatchRow;
  value: MatchValue;
  coverUrl?: string | null;
}) {
  if (row.field === "cover") {
    const src = coverUrl ?? (value === null ? null : String(value));
    return src ? (
      <img src={src} alt="" className="h-16 w-11 rounded-sm object-cover" />
    ) : (
      <span className="italic text-fg-muted">none</span>
    );
  }
  const text = shown(row.field, value);
  if (text === null)
    return <span className="italic text-fg-muted">empty</span>;
  return (
    <span
      className={`break-words ${row.field === "description" ? "line-clamp-3" : ""}`}
    >
      {text}
    </span>
  );
}

function housePath(h: MatchHouse) {
  return [h.name, h.parentName, h.groupName].filter(Boolean).join(" · ");
}

function HouseList({ houses }: { houses: MatchHouse[] }) {
  if (!houses.length) return <span className="italic text-fg-muted">none</span>;
  return (
    <span className="break-words">{houses.map(housePath).join("; ")}</span>
  );
}

function Tick({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <CapAligned height={13}>
      <input
        type="checkbox"
        aria-label={label}
        className="m-0 block h-[13px] w-[13px]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </CapAligned>
  );
}

const ARROW = (
  <CapAligned height={12}>
    <ArrowRight className="block h-3 w-3 text-fg-muted" strokeWidth={1.5} />
  </CapAligned>
);

/**
 * The second step of Match (task 0184): what the source would change, field
 * by field. The reader ticks the values to keep; the house row shows where
 * the edition links with the ticked values.
 */
export function MatchPreviewStep({
  editionId,
  preview,
  saving,
  onCancel,
  onSave,
}: {
  editionId: string;
  preview: MatchPreview;
  saving: boolean;
  onCancel: () => void;
  onSave: (
    accepted: { field: MatchField; value: MatchValue }[],
    relink: boolean,
  ) => void;
}) {
  const [ticked, setTicked] = useState(
    () => new Set(preview.rows.filter((r) => r.checked).map((r) => r.field)),
  );
  const [relink, setRelink] = useState(
    preview.houses.confirmed && preview.newEdition,
  );
  const [houses, setHouses] = useState<MatchHouses>(preview.houses);
  const [housesLoading, setHousesLoading] = useState(false);
  const request = useRef(0);

  function valuesWith(next: Set<MatchField>): HouseFields {
    const values = { ...preview.current };
    for (const field of HOUSE_FIELDS) {
      const row = preview.rows.find((r) => r.field === field);
      if (row && next.has(field)) values[field] = row.next as string | null;
    }
    return values;
  }

  async function toggle(field: MatchField, on: boolean) {
    const next = new Set(ticked);
    if (on) next.add(field);
    else next.delete(field);
    setTicked(next);
    if (!HOUSE_FIELDS.includes(field as keyof HouseFields)) return;
    const id = ++request.current;
    setHousesLoading(true);
    try {
      const fresh = await previewMatchHouses(editionId, valuesWith(next));
      if (id === request.current) setHouses(fresh);
    } finally {
      if (id === request.current) setHousesLoading(false);
    }
  }

  const accepted = preview.rows
    .filter((r) => ticked.has(r.field) && !r.blocked)
    .map((r) => ({ field: r.field, value: r.next }));
  const houseFieldsOffered = preview.rows.some((r) =>
    HOUSE_FIELDS.includes(r.field as keyof HouseFields),
  );
  const sameIds = (a: MatchHouse[], b: MatchHouse[]) =>
    a.map((h) => h.id).sort().join() === b.map((h) => h.id).sort().join();
  // Links set by hand stay unless the reader lets them follow the data
  const nextHouses =
    houses.confirmed && !relink ? houses.current : houses.next;
  const showHouse =
    houseFieldsOffered ||
    !sameIds(houses.current, houses.next) ||
    (houses.confirmed && relink);
  const changes = accepted.length + (houses.confirmed && relink ? 1 : 0);

  if (preview.locked)
    return (
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">
          This edition is locked. Unlock it in the edition form, then match it
          again.
        </p>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Back to results
          </Button>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-secondary">
        {!preview.rows.length
          ? `Nothing new. ${preview.sourceLabel} agrees with your edition.`
          : preview.newEdition
            ? "This is another edition: its ISBN is new. Every change is ticked."
            : "Same edition. Only empty fields are ticked. Your values stay unless you tick them."}
      </p>

      {preview.warnings.length > 0 && (
        <div className="space-y-1 rounded-sm border border-accent-gold/15 bg-accent-gold/5 p-3">
          {preview.warnings.map((w) => (
            <p key={w} className="text-xs text-fg-secondary">
              {w}
            </p>
          ))}
        </div>
      )}

      {(preview.rows.length > 0 || showHouse) && (
        <div className="max-h-[50vh] overflow-y-auto rounded-sm border border-glass-border bg-bg-primary/40">
          {/* Phones: the field name on its own line, the values below it */}
          <div className="grid grid-cols-[13px_minmax(0,1fr)_12px_minmax(0,1fr)] gap-x-3 px-3 text-xs leading-5 sm:grid-cols-[13px_5.5rem_minmax(0,1fr)_12px_minmax(0,1fr)]">
            {preview.rows.map((row) => (
              <label
                key={row.field}
                className="col-span-4 grid grid-cols-subgrid gap-y-1 border-b border-glass-border/60 py-2.5 last:border-b-0 sm:col-span-5"
              >
                <Tick
                  label={MATCH_FIELD_LABEL[row.field]}
                  checked={ticked.has(row.field) && !row.blocked}
                  disabled={!!row.blocked || saving}
                  onChange={(on) => toggle(row.field, on)}
                />
                <span className="col-span-3 text-fg-muted sm:col-span-1">
                  {MATCH_FIELD_LABEL[row.field]}
                </span>
                <span className="col-start-2 text-fg-secondary sm:col-start-auto">
                  <Value
                    row={row}
                    value={row.current}
                    coverUrl={
                      row.field === "cover" ? preview.currentCoverUrl : undefined
                    }
                  />
                </span>
                {ARROW}
                <span className="text-fg-primary">
                  {row.next === null ? (
                    <span className="italic text-fg-muted">clear</span>
                  ) : (
                    <Value row={row} value={row.next} />
                  )}
                </span>
                {(row.note || row.blocked) && (
                  <span
                    className={`col-start-4 text-micro leading-4 sm:col-start-5 ${row.blocked ? "text-accent-red" : "text-fg-muted"}`}
                  >
                    {row.blocked ?? row.note}
                  </span>
                )}
              </label>
            ))}

            {showHouse && (
              <div className="col-span-4 grid grid-cols-subgrid gap-y-1 py-2.5 sm:col-span-5">
                {houses.confirmed ? (
                  <Tick
                    label="Link the house again from the new data"
                    checked={relink}
                    disabled={saving}
                    onChange={setRelink}
                  />
                ) : (
                  <span />
                )}
                <span className="col-span-3 text-fg-muted sm:col-span-1">
                  House
                </span>
                <span className="col-start-2 text-fg-secondary sm:col-start-auto">
                  <HouseList houses={houses.current} />
                </span>
                {ARROW}
                <span
                  className={`text-fg-primary transition-opacity ${housesLoading ? "opacity-40" : ""}`}
                >
                  <HouseList houses={nextHouses} />
                </span>
                <span className="col-start-4 text-micro leading-4 text-fg-muted sm:col-start-5">
                  {houses.confirmed
                    ? relink
                      ? "You set these links by hand. Ticked: they follow the new data."
                      : "You set these links by hand. They stay."
                    : houses.unknownName && !houses.next.length
                      ? `No house has the name “${houses.unknownName}” yet. Durtal adds it when it is safe, or asks you in Publishers → Publisher names.`
                      : "Follows from the publisher, imprint and ISBN."}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-fg-muted">
          {preview.same > 0 &&
            `${preview.same} ${preview.same === 1 ? "field agrees" : "fields agree"} already.`}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saving || changes === 0}
            onClick={() => onSave(accepted, houses.confirmed && relink)}
          >
            {saving ? (
              <>
                <Spinner className="h-3.5 w-3.5" />
                Saving...
              </>
            ) : changes === 0 ? (
              "Nothing to save"
            ) : (
              `Save ${changes} ${changes === 1 ? "change" : "changes"}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
