/*
 * Interchange version 3 (SLN-462) adds the original title of a work
 * (`works.original_title`). A version 2 file, or a version 1 file after its
 * own reader, has none: its works read as version 3 rows with an empty
 * original title.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The records of a version 2 file as version 3 records */
export function recordsFromVersion2(records: unknown[]): unknown[] {
  return records.map((record) => {
    if (!isObject(record) || !isObject(record.sections)) return record;
    const identity = record.sections.identity;
    if (!isObject(identity) || !Array.isArray(identity.works)) return record;
    const works = identity.works.map((row) =>
      isObject(row) && !("original_title" in row) ? { ...row, original_title: null } : row,
    );
    return { ...record, sections: { ...record.sections, identity: { ...identity, works } } };
  });
}
