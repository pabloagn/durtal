import { z } from "zod";
import { catalogueDateSchema, datesInOrder } from "@/lib/catalogue/dates";
import {
  ART_OBJECT_KINDS,
  ART_OWNERSHIPS,
  DIMENSION_UNITS,
  DISPLAY_STATUSES,
  MAX_DIMENSION,
  WHEREABOUTS_CERTAINTY,
  WHEREABOUTS_CUSTODY,
  WHEREABOUTS_PLACES,
  WHEREABOUTS_STALE_DAYS,
} from "@/lib/catalogue/paintings";
import {
  PERSONAL_HOLDING_STATUSES,
  checkPersonalHolding,
} from "@/lib/catalogue/holdings";
import { ATTRIBUTIONS } from "@/lib/catalogue/credits";
import { creditListSchema } from "./people";

const date = catalogueDateSchema.nullable();
const label = (max: number) => z.string().trim().min(1).max(max).nullable();
const dateOrder = "The end date cannot precede the start date";
function uniqueIds(message: string) {
  return z
    .array(z.uuid())
    .max(200)
    .superRefine((list, ctx) => {
      if (new Set(list).size !== list.length)
        ctx.addIssue({ code: "custom", message });
    });
}

const paintingFields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(50000).nullable(),
  /** When the work was made; a range such as 1503–1519 is common. */
  creationDate: date,
  sourceRecordId: z.uuid().nullable(),
  /** Painters and other work credits, in credited order. */
  credits: creditListSchema,
  /** Genres, techniques, media and supports that describe the whole work. */
  classificationItemIds: uniqueIds("List each classification once"),
  artMovementIds: uniqueIds("List each movement once"),
};
/** A curated painting needs no object, edition or owned copy. */
export const createPaintingSchema = z.strictObject({
  title: paintingFields.title,
  description: paintingFields.description.default(null),
  creationDate: date.default(null),
  credits: creditListSchema.default([]),
  classificationItemIds: paintingFields.classificationItemIds.default([]),
  artMovementIds: paintingFields.artMovementIds.default([]),
});
/** Each supplied section replaces that section; omitted sections stay as they are. */
export const updatePaintingSchema = z.strictObject(paintingFields).partial();

/** One attributed hand for an object: "Workshop of", "attributed to" and so on. */
export const objectCreditSchema = z
  .strictObject({
    id: z.uuid().optional(),
    personId: z.uuid().nullable(),
    creditedAs: label(300).default(null),
    attribution: z.enum(ATTRIBUTIONS).default("unspecified"),
    sourceRecordId: z.uuid().nullable().default(null),
    notes: z.string().max(10000).nullable().default(null),
  })
  .refine(
    (v) =>
      !!v.personId ||
      !!v.creditedAs ||
      v.attribution === "unknown" ||
      v.attribution === "anonymous",
    "Choose a painter, record the credited name or mark the attribution unknown",
  );
const dimension = z
  .number()
  .finite()
  .min(0.001)
  .max(MAX_DIMENSION)
  .multipleOf(0.001)
  .nullable();
const objectFields = {
  kind: z.enum(ART_OBJECT_KINDS),
  label: label(200),
  reproducesObjectId: z.uuid().nullable(),
  creationDate: date,
  height: dimension,
  width: dimension,
  depth: dimension,
  dimensionUnit: z.enum(DIMENSION_UNITS).nullable(),
  dimensionsNote: label(500),
  /** null inherits the painting's painters; [] records no attributed hand. */
  attribution: z.array(objectCreditSchema).max(50).nullable(),
  /** Technique, medium and support of this object; each family present replaces the painting's. */
  classificationItemIds: uniqueIds("List each classification once"),
  ownership: z.enum(ART_OWNERSHIPS),
  ownerOrganizationId: z.uuid().nullable(),
  ownerLabel: label(300),
  collectionName: label(300),
  accessionNumber: label(200),
  holdingStatus: z.enum(PERSONAL_HOLDING_STATUSES).nullable(),
  locationId: z.uuid().nullable(),
  subLocationId: z.uuid().nullable(),
  acquisitionDate: date,
  venueId: z.uuid().nullable(),
  acquisitionPrice: z.number().finite().nonnegative().max(999999999.99).nullable(),
  acquisitionCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  dispositionDate: date,
  dispositionReason: label(1000),
  notes: z.string().max(10000).nullable(),
  sourceRecordId: z.uuid().nullable(),
};
/** Values for a new object when the input leaves a field out. */
export const ART_OBJECT_DEFAULTS = {
  label: null,
  reproducesObjectId: null,
  creationDate: null,
  height: null,
  width: null,
  depth: null,
  dimensionUnit: null,
  dimensionsNote: null,
  attribution: null,
  classificationItemIds: [],
  ownership: "unknown",
  ownerOrganizationId: null,
  ownerLabel: null,
  collectionName: null,
  accessionNumber: null,
  holdingStatus: null,
  locationId: null,
  subLocationId: null,
  acquisitionDate: null,
  venueId: null,
  acquisitionPrice: null,
  acquisitionCurrency: null,
  dispositionDate: null,
  dispositionReason: null,
  notes: null,
  sourceRecordId: null,
} as const;
const PERSONAL_FIELDS = [
  "locationId",
  "subLocationId",
  "acquisitionDate",
  "venueId",
  "acquisitionPrice",
  "acquisitionCurrency",
  "dispositionDate",
  "dispositionReason",
] as const;
/** A whole art object, validated across its fields. */
export const artObjectRecordSchema = z
  .strictObject(objectFields)
  .superRefine((v, ctx) => {
    const issue = (message: string, path?: string) =>
      ctx.addIssue({ code: "custom", message, ...(path && { path: [path] }) });
    if (v.reproducesObjectId && v.kind !== "reproduction")
      issue("Only a reproduction reproduces another object", "reproducesObjectId");
    const measured = v.height !== null || v.width !== null || v.depth !== null;
    if (measured !== (v.dimensionUnit !== null))
      issue(
        measured ? "Choose a unit for the dimensions" : "A unit needs a dimension",
        "dimensionUnit",
      );
    if ((v.ownership === "institutional") !== (v.ownerOrganizationId !== null))
      issue(
        "An institutional owner names its organization, and only then",
        "ownerOrganizationId",
      );
    if (v.ownerLabel && v.ownership !== "private")
      issue("Describe an owner only for a private collection", "ownerLabel");
    if ((v.collectionName || v.accessionNumber) && v.ownership !== "institutional")
      issue(
        "A collection and accession number belong to an institutional owner",
        "accessionNumber",
      );
    if ((v.ownership === "personal") !== (v.holdingStatus !== null))
      issue(
        "A personally owned object has a holding status, and only then",
        "holdingStatus",
      );
    if (v.ownership === "personal")
      checkPersonalHolding(
        {
          ...v,
          status: v.holdingStatus!,
          hasDisposition: !!v.dispositionDate || !!v.dispositionReason,
        },
        ctx,
      );
    else if (PERSONAL_FIELDS.some((field) => v[field] !== null))
      issue("Storage, acquisition and disposition belong to personal objects");
    if (!datesInOrder(v.acquisitionDate, v.dispositionDate)) issue(dateOrder);
  });
/** Supplied fields only. Merged with defaults or the stored object, then validated whole. */
export const artObjectPatchSchema = z.strictObject(objectFields).partial();

const whereaboutsFields = {
  placeKind: z.enum(WHEREABOUTS_PLACES),
  venueId: z.uuid().nullable(),
  placeLabel: label(300),
  custody: z.enum(WHEREABOUTS_CUSTODY),
  displayStatus: z.enum(DISPLAY_STATUSES),
  certainty: z.enum(WHEREABOUTS_CERTAINTY),
  /** null start: since an unknown date. null end: still there. */
  startsOn: date,
  endsOn: date,
  occasionLabel: label(300),
  /** When the location was last checked against a source. */
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  notes: z.string().max(10000).nullable(),
  sourceRecordId: z.uuid().nullable(),
};
/** Values for a new record when the input leaves a field out. */
export const WHEREABOUTS_DEFAULTS = {
  venueId: null,
  placeLabel: null,
  custody: "unknown",
  displayStatus: "unknown",
  startsOn: null,
  endsOn: null,
  occasionLabel: null,
  verifiedAt: null,
  notes: null,
  sourceRecordId: null,
} as const;
const AT_VENUE = ["permanent_collection", "temporary_loan", "long_term_loan"];
/** A whole location record, validated across its fields. */
export const whereaboutsRecordSchema = z
  .strictObject(whereaboutsFields)
  .superRefine((v, ctx) => {
    const issue = (message: string, path?: string) =>
      ctx.addIssue({ code: "custom", message, ...(path && { path: [path] }) });
    if ((v.placeKind === "venue") !== (v.venueId !== null))
      issue("A venue location names its venue, and only then", "venueId");
    if (AT_VENUE.includes(v.custody) && v.placeKind !== "venue")
      issue("Collections and loans are at a venue", "custody");
    if (v.displayStatus !== "unknown" && v.placeKind !== "venue")
      issue("Display and storage are stated only at a venue", "displayStatus");
    if ((v.placeKind === "lost" || v.placeKind === "destroyed") && v.custody !== "unknown")
      issue("A lost or destroyed object has no custody", "custody");
    if (!datesInOrder(v.startsOn, v.endsOn)) issue(dateOrder);
  });
/** Supplied fields only. Merged with defaults or the stored record, then validated whole. */
export const whereaboutsPatchSchema = z.strictObject(whereaboutsFields).partial();
export type WhereaboutsPatch = z.input<typeof whereaboutsPatchSchema>;
export type WhereaboutsInput = WhereaboutsPatch & {
  objectId: string;
  placeKind: (typeof WHEREABOUTS_PLACES)[number];
  certainty: (typeof WHEREABOUTS_CERTAINTY)[number];
};
export const whereaboutsReadSchema = z.strictObject({
  staleAfterDays: z.number().int().min(1).max(3650).default(WHEREABOUTS_STALE_DAYS),
});

const year = z.number().int().min(-999999).max(999999);
export const PAINTING_SORTS = ["title", "created", "recent", "rating"] as const;
export const paintingQuerySchema = z
  .strictObject({
    search: z.string().trim().max(200).optional(),
    /** Any of these as painter of the work or attributed hand of an object. */
    painterIds: z.array(z.uuid()).max(50).optional(),
    /** Every item must match, directly or through a narrower item. */
    taxonomyItemIds: z.array(z.uuid()).max(50).optional(),
    artMovementIds: z.array(z.uuid()).max(50).optional(),
    /** Any object owned by one of these institutions. */
    ownerOrganizationIds: z.array(z.uuid()).max(50).optional(),
    /** Any object whose confirmed current location is one of these venues. */
    currentVenueIds: z.array(z.uuid()).max(50).optional(),
    /** The creation period overlaps these years; unknown never matches. */
    createdFrom: year.optional(),
    createdTo: year.optional(),
    /** Personally owned objects that are not disposed. */
    holding: z.enum(["any", "owned", "not_owned"]).default("any"),
    favourite: z.boolean().optional(),
    sort: z.enum(PAINTING_SORTS).default("title"),
    order: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(200).default(48),
    offset: z.number().int().min(0).max(1000000).default(0),
  })
  .refine(
    (v) =>
      v.createdFrom === undefined ||
      v.createdTo === undefined ||
      v.createdFrom <= v.createdTo,
    "The first year cannot follow the last year",
  );
export type PaintingQuery = z.input<typeof paintingQuerySchema>;
export type CreatePaintingInput = z.input<typeof createPaintingSchema>;
export type UpdatePaintingInput = z.input<typeof updatePaintingSchema>;
export type ArtObjectPatch = z.input<typeof artObjectPatchSchema>;
export type ArtObjectInput = ArtObjectPatch & {
  workId: string;
  kind: (typeof ART_OBJECT_KINDS)[number];
};
