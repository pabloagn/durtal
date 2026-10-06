import { InterchangeFileError } from "./errors";

/*
 * Interchange version 1 (SLN-375) carried two columns on book copies that
 * version 2 (SLN-490) no longer has: the links to the old e-book library. A
 * version 1 file reads as version 2 when they are empty on every copy; one
 * that holds a link is refused, so nothing is dropped without a word. This
 * file reads files written before SLN-490, like a migration: it is the one
 * place outside history that names the old columns.
 */

const DROPPED = ["calibre_id", "calibre_url"] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The records of a version 1 file as version 2 records */
export function recordsFromVersion1(records: unknown[]): unknown[] {
  let linked = 0;
  const out = records.map((record) => {
    if (!isObject(record) || !isObject(record.sections)) return record;
    const holdings = record.sections.holdings;
    if (!isObject(holdings) || !Array.isArray(holdings.instances)) return record;
    const instances = holdings.instances.map((row) => {
      if (!isObject(row)) return row;
      if (DROPPED.some((column) => row[column] !== null && row[column] !== undefined)) linked++;
      const copy = { ...row };
      for (const column of DROPPED) delete copy[column];
      return copy;
    });
    return { ...record, sections: { ...record.sections, holdings: { ...holdings, instances } } };
  });
  if (linked)
    throw new InterchangeFileError(
      `This file has Calibre links on ${linked} ${linked === 1 ? "copy" : "copies"}, which this Durtal no longer keeps`,
    );
  return out;
}
