"use server";

import { recordWorkEvents } from "@/lib/activity/work-changes";
import {
  ART_OBJECT_KIND_LABELS,
  CERTAINTY_LABELS,
  CUSTODY_LABELS,
  PLACE_LABELS,
  type WhereaboutsCertainty,
  type WhereaboutsCustody,
  type WhereaboutsPlace,
} from "@/lib/catalogue/painting-labels";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { artObjects, artObjectWhereabouts, venues } from "@/lib/db/schema";
import {
  WHEREABOUTS_DEFAULTS,
  whereaboutsPatchSchema,
  whereaboutsReadSchema,
  whereaboutsRecordSchema,
  type WhereaboutsInput,
  type WhereaboutsPatch,
} from "@/lib/validations/paintings";
import { fingerprintSchema } from "@/lib/validations/records";
import { whereaboutsFingerprint } from "@/lib/catalogue/painting-store";
import {
  STALE_RECORD,
  insertDates,
  loadDates,
  newDate,
  readFingerprint,
  releaseDates,
  replaceDate,
  storedDate,
  supplied,
} from "@/lib/catalogue/work-store";
import { normalizeCatalogueDate, type CatalogueDate } from "@/lib/catalogue/dates";
import { assertSql } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";

type WhereaboutsRecord = z.output<typeof whereaboutsRecordSchema>;

function write(build: Parameters<typeof atomic>[0]) {
  return withReadableErrors(() => atomic(build), {
    unique:
      "This object already has a confirmed current location; record a move or close it first",
  });
}
function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.venues);
}
function lockObject(d: typeof db, objectId: string) {
  return d.execute(
    sql`select id from art_objects where id=${objectId}::uuid for update`,
  );
}
function historyUnchanged(d: typeof db, objectId: string, expected: string) {
  return d.execute(
    assertSql(
      sql`coalesce(${whereaboutsFingerprint(sql`${objectId}::uuid`)}=${expected},false)`,
      STALE_RECORD,
    ),
  );
}
async function freshHistory(objectId: string, expected: string) {
  const object = await db.query.artObjects.findFirst({
    where: eq(artObjects.id, objectId),
    columns: { id: true },
  });
  if (!object) throw new Error("Object not found");
  if (
    (await readFingerprint(whereaboutsFingerprint(sql`${objectId}::uuid`))) !==
    expected
  )
    throw new Error(STALE_RECORD);
}
function rowValues(
  record: WhereaboutsRecord,
  dates: { startsOnId: string | null; endsOnId: string | null },
) {
  const { startsOn: _start, endsOn: _end, verifiedAt, ...fields } = record;
  return {
    ...fields,
    ...dates,
    verifiedAt: verifiedAt ? new Date(verifiedAt) : null,
  };
}
/** Bounds of a period; an unknown start or an open end reaches indefinitely. */
function bounds(start: CatalogueDate | undefined, end: CatalogueDate | undefined) {
  return {
    from: start ? (normalizeCatalogueDate(start).lowerBound ?? -Infinity) : -Infinity,
    to: end ? (normalizeCatalogueDate(end).upperBound ?? Infinity) : Infinity,
  };
}

/**
 * The object's location history, newest first, with its confirmed current
 * location. Probable and uncertain claims that may overlap the current period
 * at another place are listed as conflicts; an unchecked current location is
 * flagged as stale. Holding an object never implies it is on display.
 */
export async function getWhereabouts(
  objectId: string,
  options: z.input<typeof whereaboutsReadSchema> = {},
) {
  z.uuid().parse(objectId);
  const { staleAfterDays } = whereaboutsReadSchema.parse(options);
  const object = await db.query.artObjects.findFirst({
    where: eq(artObjects.id, objectId),
    columns: { id: true },
  });
  if (!object) return null;
  const [rows, fingerprint] = await Promise.all([
    db
      .select({
        record: artObjectWhereabouts,
        venueName: venues.name,
        venueSlug: venues.slug,
        venueArchivedAt: venues.archivedAt,
      })
      .from(artObjectWhereabouts)
      .leftJoin(venues, eq(artObjectWhereabouts.venueId, venues.id))
      .where(eq(artObjectWhereabouts.objectId, objectId))
      .orderBy(asc(artObjectWhereabouts.recordedAt), asc(artObjectWhereabouts.id)),
    readFingerprint(whereaboutsFingerprint(sql`${objectId}::uuid`)),
  ]);
  const dates = await loadDates(
    rows.flatMap(({ record }) => [record.startsOnId, record.endsOnId]),
  );
  const records = rows
    .map(({ record, ...venue }) => {
      const startsOn = storedDate(dates, record.startsOnId);
      const endsOn = storedDate(dates, record.endsOnId);
      return {
        ...record,
        ...venue,
        startsOn,
        endsOn,
        period: bounds(startsOn?.value, endsOn?.value),
      };
    })
    // Newest start first; records with an unknown start come last.
    .sort((a, b) =>
      a.period.from === b.period.from ? 0 : a.period.from < b.period.from ? 1 : -1,
    );
  const current =
    records.find((r) => r.certainty === "confirmed" && !r.endsOn) ?? null;
  const conflicts = records.filter(
    (r) =>
      r.certainty !== "confirmed" &&
      (current
        ? r.period.from <= current.period.to &&
          current.period.from <= r.period.to &&
          (r.placeKind !== current.placeKind || r.venueId !== current.venueId)
        : !r.endsOn &&
          records.some(
            (o) =>
              o !== r &&
              !o.endsOn &&
              o.certainty !== "confirmed" &&
              (o.placeKind !== r.placeKind || o.venueId !== r.venueId),
          )),
  );
  const checkedAt = current ? (current.verifiedAt ?? current.recordedAt) : null;
  const ageDays = checkedAt
    ? Math.max(0, Math.floor((Date.now() - checkedAt.getTime()) / 86400000))
    : null;
  return {
    objectId,
    current,
    records,
    conflicts,
    ageDays,
    isStale: ageDays !== null && ageDays >= staleAfterDays,
    fingerprint: fingerprint!,
  };
}

/**
 * Adds a location record. A confirmed, open-ended record is a move: the current
 * confirmed location, if any, is closed on the move's start date in the same
 * transaction. Of two moves made from the same history, only one is saved.
 */
export async function recordWhereabouts(
  input: WhereaboutsInput,
  fingerprint: string,
) {
  const { objectId, ...fields } = input;
  z.uuid().parse(objectId);
  const record = whereaboutsRecordSchema.parse({
    ...WHEREABOUTS_DEFAULTS,
    ...supplied(whereaboutsPatchSchema.parse(fields)),
  });
  const expected = fingerprintSchema.parse(fingerprint);
  await freshHistory(objectId, expected);
  const current =
    record.certainty === "confirmed" && !record.endsOn
      ? await db.query.artObjectWhereabouts.findFirst({
          where: and(
            eq(artObjectWhereabouts.objectId, objectId),
            eq(artObjectWhereabouts.certainty, "confirmed"),
            isNull(artObjectWhereabouts.endsOnId),
          ),
        })
      : undefined;
  if (current && !record.startsOn)
    throw new Error(
      "Give the date of the move, so the current location can be closed",
    );
  const starts = newDate(record.startsOn),
    ends = newDate(record.endsOn);
  // The closed record owns its own copy of the move date.
  const closing = current ? newDate(record.startsOn) : null;
  const id = randomUUID();
  await write((d) => [
    lockObject(d, objectId),
    historyUnchanged(d, objectId, expected),
    ...insertDates(d, [starts, ends, closing]),
    ...(current && closing
      ? [
          d
            .update(artObjectWhereabouts)
            .set({ endsOnId: closing.id, updatedAt: new Date() })
            .where(eq(artObjectWhereabouts.id, current.id)),
        ]
      : []),
    d.insert(artObjectWhereabouts).values({
      id,
      objectId,
      ...rowValues(record, {
        startsOnId: starts?.id ?? null,
        endsOnId: ends?.id ?? null,
      }),
    }),
  ]);
  changed();
  const history = (await getWhereabouts(objectId))!;
  await recordMove(objectId, history.records.find((r) => r.id === id), current && history.records.find((r) => r.id === current.id));
  return history;
}

/** "Louvre, Paris", "In a private place: Geneva": a record's place as the history names it */
function placeName(r: { placeKind: WhereaboutsPlace; venueName: string | null; placeLabel: string | null }) {
  return r.venueName ?? [PLACE_LABELS[r.placeKind], r.placeLabel].filter(Boolean).join(": ");
}

/**
 * A painting move in its work's history: where from (the confirmed location
 * it closed, if any), where to, with custody and certainty as recorded.
 */
async function recordMove(
  objectId: string,
  to: { placeKind: WhereaboutsPlace; venueName: string | null; placeLabel: string | null; custody: WhereaboutsCustody; certainty: WhereaboutsCertainty } | undefined,
  from: { placeKind: WhereaboutsPlace; venueName: string | null; placeLabel: string | null } | null | undefined,
) {
  if (!to) return;
  const object = await db.query.artObjects.findFirst({
    where: eq(artObjects.id, objectId),
    columns: { workId: true, kind: true, label: true },
  });
  if (!object) return;
  await recordWorkEvents(object.workId, [
    {
      eventKey: "work.location_recorded",
      metadata: {
        oldValue: from ? placeName(from) : null,
        newValue: placeName(to),
        extra: {
          object: [ART_OBJECT_KIND_LABELS[object.kind], object.label].filter(Boolean).join(": "),
          custody: CUSTODY_LABELS[to.custody],
          certainty: CERTAINTY_LABELS[to.certainty],
        },
      },
    },
  ]);
}

/**
 * Corrects one record, including backdated dates. The merged record is
 * validated whole; confirmed periods may still not overlap.
 */
export async function updateWhereabouts(
  id: string,
  input: WhereaboutsPatch,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const patch = supplied(whereaboutsPatchSchema.parse(input));
  const expected = fingerprintSchema.parse(fingerprint);
  const stored = await db.query.artObjectWhereabouts.findFirst({
    where: eq(artObjectWhereabouts.id, id),
  });
  if (!stored) throw new Error("Location record not found");
  await freshHistory(stored.objectId, expected);
  const dates = await loadDates([stored.startsOnId, stored.endsOnId]);
  const startsOn = storedDate(dates, stored.startsOnId);
  const endsOn = storedDate(dates, stored.endsOnId);
  const record = whereaboutsRecordSchema.parse({
    placeKind: stored.placeKind,
    venueId: stored.venueId,
    placeLabel: stored.placeLabel,
    custody: stored.custody,
    displayStatus: stored.displayStatus,
    certainty: stored.certainty,
    startsOn: startsOn?.value ?? null,
    endsOn: endsOn?.value ?? null,
    occasionLabel: stored.occasionLabel,
    verifiedAt: stored.verifiedAt?.toISOString() ?? null,
    notes: stored.notes,
    sourceRecordId: stored.sourceRecordId,
    ...patch,
  });
  const starts = replaceDate(startsOn, patch.startsOn);
  const ends = replaceDate(endsOn, patch.endsOn);
  await write((d) => [
    lockObject(d, stored.objectId),
    historyUnchanged(d, stored.objectId, expected),
    ...insertDates(d, [starts?.row, ends?.row]),
    d
      .update(artObjectWhereabouts)
      .set({
        ...rowValues(record, {
          startsOnId: starts ? (starts.row?.id ?? null) : stored.startsOnId,
          endsOnId: ends ? (ends.row?.id ?? null) : stored.endsOnId,
        }),
        updatedAt: new Date(),
      })
      .where(eq(artObjectWhereabouts.id, id)),
    ...releaseDates(d, [starts?.oldId, ends?.oldId]),
  ]);
  changed();
  return (await getWhereabouts(stored.objectId))!;
}

/** Records that the location was checked now (or at the given time). */
export async function verifyWhereabouts(
  id: string,
  fingerprint: string,
  at?: string,
) {
  return updateWhereabouts(
    id,
    { verifiedAt: at ?? new Date().toISOString() },
    fingerprint,
  );
}

export async function deleteWhereabouts(id: string, fingerprint: string) {
  z.uuid().parse(id);
  const expected = fingerprintSchema.parse(fingerprint);
  const stored = await db.query.artObjectWhereabouts.findFirst({
    where: eq(artObjectWhereabouts.id, id),
  });
  if (!stored) throw new Error("Location record not found");
  await freshHistory(stored.objectId, expected);
  await write((d) => [
    lockObject(d, stored.objectId),
    historyUnchanged(d, stored.objectId, expected),
    d.delete(artObjectWhereabouts).where(eq(artObjectWhereabouts.id, id)),
    ...releaseDates(d, [stored.startsOnId, stored.endsOnId]),
  ]);
  changed();
  return (await getWhereabouts(stored.objectId))!;
}
