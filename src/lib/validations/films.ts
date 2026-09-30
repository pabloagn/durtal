import { z } from "zod";
import { catalogueDateSchema, datesInOrder } from "@/lib/catalogue/dates";
import {
  FILM_HOLDING_MEDIA,
  FILM_ORGANIZATION_ROLES,
  FILM_RELEASE_FORMATS,
  MAX_FILM_RUNTIME_SECONDS,
} from "@/lib/catalogue/films";
import {
  PERSONAL_HOLDING_STATUSES,
  checkPersonalHolding,
} from "@/lib/catalogue/holdings";
import { creditListSchema } from "./people";

const source = z.uuid().nullable().default(null);
const date = catalogueDateSchema.nullable();
const label = (max: number) => z.string().trim().min(1).max(max).nullable();
function unique<T>(key: (value: T) => string, message: string) {
  return (list: T[], ctx: z.RefinementCtx) => {
    if (new Set(list.map(key)).size !== list.length)
      ctx.addIssue({ code: "custom", message });
  };
}
const ids = (message: string) =>
  z
    .array(z.uuid())
    .max(200)
    .superRefine(unique((id) => id, message));

export const filmOrganizationInputSchema = z.strictObject({
  organizationId: z.uuid(),
  role: z.enum(FILM_ORGANIZATION_ROLES),
  sourceRecordId: source,
});
/** Array order is the credited order. */
const organizations = z
  .array(filmOrganizationInputSchema)
  .max(100)
  .superRefine(
    unique(
      (o) => `${o.organizationId}:${o.role}`,
      "List each company once per role",
    ),
  );
const filmFields = {
  title: z.string().trim().min(1).max(500),
  originalTitle: label(500),
  description: z.string().trim().max(50000).nullable(),
  releaseDate: date,
  sourceRecordId: z.uuid().nullable(),
  /** Production countries and original languages, in credited order. */
  countryIds: ids("List each country once"),
  languageIds: ids("List each language once"),
  organizations,
  /** Cast and crew in billing order; one performer may play several characters. */
  credits: creditListSchema,
  classificationItemIds: ids("List each classification once"),
};
/** A film identity. A remake is a separate film; a cut is a version of one. */
export const createFilmSchema = z
  .strictObject({
    title: filmFields.title,
    originalTitle: filmFields.originalTitle.default(null),
    description: filmFields.description.default(null),
    releaseDate: date.default(null),
    countryIds: filmFields.countryIds.default([]),
    languageIds: filmFields.languageIds.default([]),
    organizations: organizations.default([]),
    credits: creditListSchema.default([]),
    classificationItemIds: filmFields.classificationItemIds.default([]),
  })
  .refine(
    (v) => v.organizations.every((o) => !o.sourceRecordId),
    "Record sources after the film exists",
  );
/** Each supplied section replaces that section; omitted sections stay as they are. */
export const updateFilmSchema = z
  .strictObject({
    ...filmFields,
    /** Every version of the film, in display order. */
    versionOrder: ids("List each version once"),
  })
  .partial();

export const filmReleaseInputSchema = z.strictObject({
  /** A kept release keeps its ID, so copies that name it stay linked. */
  id: z.uuid().optional(),
  countryId: z.uuid().nullable().default(null),
  territoryLabel: label(200).default(null),
  format: z.enum(FILM_RELEASE_FORMATS),
  releaseDate: date.default(null),
  distributorId: z.uuid().nullable().default(null),
  notes: z.string().max(10000).nullable().default(null),
  sourceRecordId: source,
});
const releases = z
  .array(filmReleaseInputSchema)
  .max(200)
  .superRefine((list, ctx) => {
    const kept = list.flatMap((r) => (r.id ? [r.id] : []));
    if (new Set(kept).size !== kept.length)
      ctx.addIssue({ code: "custom", message: "List each release once" });
  });
const runtime = z.number().int().min(1).max(MAX_FILM_RUNTIME_SECONDS).nullable();
const versionFields = {
  label: label(200),
  /** Seconds; null when unknown. */
  runtimeSeconds: runtime,
  notes: z.string().max(10000).nullable(),
  sourceRecordId: z.uuid().nullable(),
  /** The version's releases; the list replaces the stored releases. */
  releases,
};
export const createFilmVersionSchema = z
  .strictObject({
    workId: z.uuid(),
    label: versionFields.label.default(null),
    runtimeSeconds: runtime.default(null),
    notes: versionFields.notes.default(null),
    sourceRecordId: source,
    releases: releases.default([]),
  })
  .refine(
    (v) => v.releases.every((r) => !r.id),
    "A new version has no existing releases",
  );
export const updateFilmVersionSchema = z.strictObject(versionFields).partial();

const holdingFields = {
  versionId: z.uuid().nullable(),
  releaseId: z.uuid().nullable(),
  medium: z.enum(FILM_HOLDING_MEDIA),
  formatLabel: label(200),
  status: z.enum(PERSONAL_HOLDING_STATUSES),
  condition: label(300),
  locationId: z.uuid().nullable(),
  subLocationId: z.uuid().nullable(),
  acquisitionDate: date,
  supplierId: z.uuid().nullable(),
  venueId: z.uuid().nullable(),
  acquisitionPrice: z.number().finite().nonnegative().max(999999999.99).nullable(),
  acquisitionCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  dispositionDate: date,
  dispositionReason: label(1000),
  notes: z.string().max(10000).nullable(),
};
/** Values for a new copy when the input leaves a field out. */
export const FILM_HOLDING_DEFAULTS = {
  versionId: null,
  releaseId: null,
  formatLabel: null,
  status: "held",
  condition: null,
  locationId: null,
  subLocationId: null,
  acquisitionDate: null,
  supplierId: null,
  venueId: null,
  acquisitionPrice: null,
  acquisitionCurrency: null,
  dispositionDate: null,
  dispositionReason: null,
  notes: null,
} as const;
/** A whole personal copy, validated across its fields. */
export const filmHoldingRecordSchema = z
  .strictObject(holdingFields)
  .superRefine((v, ctx) =>
    checkPersonalHolding(
      { ...v, hasDisposition: !!v.dispositionDate || !!v.dispositionReason },
      ctx,
    ),
  )
  .refine(
    (v) => datesInOrder(v.acquisitionDate, v.dispositionDate),
    "The end date cannot precede the start date",
  );
/** Supplied fields only. Merged with defaults or the stored copy, then validated whole. */
export const filmHoldingPatchSchema = z.strictObject(holdingFields).partial();

const year = z.number().int().min(-999999).max(999999);
export const FILM_SORTS = [
  "title",
  "release",
  "recent",
  "rating",
  "runtime",
] as const;
export const filmQuerySchema = z
  .strictObject({
    search: z.string().trim().max(200).optional(),
    /** Any of these people, in any credit or only in `creditRoleIds`. */
    personIds: z.array(z.uuid()).max(50).optional(),
    creditRoleIds: z.array(z.string().min(1).max(300)).max(20).optional(),
    /** Every item must match, directly or through a narrower item. */
    taxonomyItemIds: z.array(z.uuid()).max(50).optional(),
    /** Any of these production countries or original languages. */
    countryIds: z.array(z.uuid()).max(50).optional(),
    languageIds: z.array(z.uuid()).max(50).optional(),
    /** The film's release period overlaps these years; unknown never matches. */
    releaseYearFrom: year.optional(),
    releaseYearTo: year.optional(),
    /** Active (not disposed) personal copies. */
    holding: z.enum(["any", "owned", "not_owned"]).default("any"),
    media: z.array(z.enum(FILM_HOLDING_MEDIA)).max(2).optional(),
    favourite: z.boolean().optional(),
    sort: z.enum(FILM_SORTS).default("title"),
    order: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(200).default(48),
    offset: z.number().int().min(0).max(1000000).default(0),
  })
  .refine(
    (v) =>
      v.releaseYearFrom === undefined ||
      v.releaseYearTo === undefined ||
      v.releaseYearFrom <= v.releaseYearTo,
    "The first year cannot follow the last year",
  )
  .refine(
    (v) => !v.media?.length || v.holding !== "not_owned",
    "Medium filters need owned films",
  )
  .refine(
    (v) => !v.creditRoleIds?.length || !!v.personIds?.length,
    "Role filters need a person",
  );
export type FilmQuery = z.input<typeof filmQuerySchema>;
export type CreateFilmInput = z.input<typeof createFilmSchema>;
export type UpdateFilmInput = z.input<typeof updateFilmSchema>;
export type CreateFilmVersionInput = z.input<typeof createFilmVersionSchema>;
export type UpdateFilmVersionInput = z.input<typeof updateFilmVersionSchema>;
export type FilmHoldingPatch = z.input<typeof filmHoldingPatchSchema>;
export type FilmHoldingInput = FilmHoldingPatch & {
  workId: string;
  medium: (typeof FILM_HOLDING_MEDIA)[number];
};
