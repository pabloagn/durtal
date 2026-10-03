import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import { parseId, toUpdateSchema } from "@/lib/validations/helpers";
import { createWorkSchema, updateWorkSchema } from "@/lib/validations/works";
import { updateAuthorSchema } from "@/lib/validations/authors";
import { updateEditionSchema } from "@/lib/validations/editions";
import { updateInstanceSchema } from "@/lib/validations/instances";
import {
  updateLocationSchema,
  updateSubLocationSchema,
  createSubLocationSchema,
} from "@/lib/validations/locations";
import { updateOrderSchema, orderStatusSchema } from "@/lib/validations/orders";
import { updateVenueSchema } from "@/lib/validations/venues";
import { collectionUpdateSchema } from "@/lib/validations/collections";
import {
  updateTaxonomyFamilySchema,
  updateTaxonomyItemSchema,
  updateWorkTaxonomySchema,
  updateGenreSchema,
  updateTagSchema,
} from "@/lib/validations/taxonomy-management";

const UPDATE_SCHEMAS: Record<string, z.ZodType> = {
  updateWorkSchema,
  updateAuthorSchema,
  updateEditionSchema,
  updateInstanceSchema,
  updateLocationSchema,
  updateSubLocationSchema,
  updateOrderSchema,
  updateVenueSchema,
  collectionUpdateSchema,
  updateTaxonomyFamilySchema,
  updateTaxonomyItemSchema,
  updateWorkTaxonomySchema,
  updateGenreSchema,
  updateTagSchema,
};

const UUID = "3f8e0b2a-5c1d-4e6f-9a7b-1c2d3e4f5a6b";

describe("update schemas", () => {
  it.each(Object.entries(UPDATE_SCHEMAS))("%s adds no default values to a partial update", (_name, schema) => {
    expect(schema.parse({})).toEqual({});
  });

  it.each(Object.entries(UPDATE_SCHEMAS))("%s rejects unknown keys", (_name, schema) => {
    expect(() => schema.parse({ createdAt: "2020-01-01" })).toThrow();
    expect(() => schema.parse({ id: UUID })).toThrow();
  });

  it("regression: a rating change does not reset the work's status, language or flags", () => {
    expect(updateWorkSchema.parse({ rating: 4 })).toEqual({ rating: 4 });
  });

  it("regression: a notes change does not reset a copy's status or flags", () => {
    expect(updateInstanceSchema.parse({ notes: "x" })).toEqual({ notes: "x" });
  });

  it("regression: an edition title change does not reset language or edition flags", () => {
    expect(updateEditionSchema.parse({ title: "x" })).toEqual({ title: "x" });
  });

  it("regression: renaming a taxonomy family keeps its hierarchy", () => {
    expect(updateTaxonomyFamilySchema.parse({ name: "x" })).toEqual({ name: "x" });
  });

  it("still validates values", () => {
    expect(() => updateWorkSchema.parse({ catalogueStatus: "owned" })).toThrow();
    expect(() => updateWorkSchema.parse({ rating: 6 })).toThrow();
    expect(() => updateWorkSchema.parse({ seriesId: "not-a-uuid" })).toThrow();
    expect(() => updateWorkSchema.parse({ slug: "hijack" })).toThrow();
    expect(() => updateWorkSchema.parse({ kind: "film" })).toThrow();
    expect(() => updateAuthorSchema.parse({ website: "not a url" })).toThrow();
    expect(() => updateAuthorSchema.parse({ slug: "hijack" })).toThrow();
    expect(() => updateEditionSchema.parse({ isbn13: "123" })).toThrow();
    expect(() => updateEditionSchema.parse({ workId: "not-a-uuid" })).toThrow();
    expect(() => updateEditionSchema.parse({ binding: "Kindle Edition" })).toThrow();
    expect(() => updateInstanceSchema.parse({ status: "gone" })).toThrow();
    expect(() => updateInstanceSchema.parse({ editionId: UUID })).toThrow(); // a copy cannot move
    expect(() => updateLocationSchema.parse({ type: "cloud" })).toThrow();
    expect(() => updateSubLocationSchema.parse({ locationId: UUID })).toThrow();
    expect(() => updateOrderSchema.parse({ status: "lost" })).toThrow();
    expect(() => updateOrderSchema.parse({ currency: "Pears" })).toThrow();
    expect(() => orderStatusSchema.parse("lost")).toThrow();
    expect(() => updateWorkTaxonomySchema.parse({ themeIds: ["x"] })).toThrow();
    expect(() => collectionUpdateSchema.parse({ posterS3Key: "private/secret.pdf" })).toThrow();
  });

  it("keeps edition reparenting, which updateEdition checks against the book boundary", () => {
    expect(updateEditionSchema.parse({ workId: UUID })).toEqual({ workId: UUID });
  });

  it("accepts the payloads the app sends", () => {
    // Work edit dialog (src/app/library/[slug]/work-edit-dialog.tsx)
    const work = {
      title: "Against Nature",
      originalLanguage: "fr",
      originalYear: 1884,
      workTypeId: null,
      isAnthology: false,
      catalogueStatus: "wanted",
      acquisitionPriority: "high",
      rating: null,
      description: null,
      notes: "Reread",
      recommenderIds: [UUID],
      seriesId: null,
      seriesName: null,
      seriesPosition: null,
      goodreadsUrl: null,
      storygraphUrl: null,
      authorIds: [{ authorId: UUID, role: "author" }],
    } as const;
    expect(updateWorkSchema.parse(work)).toEqual(work);
    // Author edit dialog (src/app/authors/[slug]/author-edit-dialog.tsx)
    const author = {
      name: "Joris-Karl Huysmans",
      sortName: "Huysmans, Joris-Karl",
      firstName: "Joris-Karl",
      lastName: "Huysmans",
      realName: "Charles-Marie-Georges Huysmans",
      gender: "male",
      nationalityId: UUID,
      birthYear: 1848,
      birthMonth: 2,
      birthDay: 5,
      birthYearIsApproximate: false,
      deathYear: 1907,
      deathMonth: 5,
      deathDay: 12,
      deathYearIsApproximate: false,
      bio: "<p>French novelist.</p>",
      website: null,
      openLibraryKey: "OL123A",
      goodreadsId: null,
    } as const;
    expect(updateAuthorSchema.parse(author)).toEqual(author);
    // Copy edit dialog and status button (src/app/library/[slug]/instance-*.tsx)
    const copy = {
      locationId: UUID,
      subLocationId: null,
      format: "hardcover",
      condition: "fine",
      status: "available",
      acquisitionType: "purchase",
      acquisitionDate: "2026-09-25",
      acquisitionSource: "Shakespeare and Company",
      acquisitionPrice: "12.50",
      acquisitionCurrency: "EUR",
      isSigned: false,
      signedBy: null,
      inscription: null,
      isFirstPrinting: false,
      provenance: null,
      hasDustJacket: true,
      hasSlipcase: null,
      conditionNotes: null,
      calibreId: null,
      calibreUrl: null,
      fileSizeBytes: null,
      notes: null,
      lentTo: null,
      lentDate: null,
      dispositionType: null,
      dispositionDate: null,
      dispositionTo: null,
      dispositionPrice: null,
      dispositionCurrency: null,
      dispositionNotes: null,
    } as const;
    expect(updateInstanceSchema.parse(copy)).toEqual(copy);
    expect(updateInstanceSchema.parse({ status: "lent_out", lentTo: "Ana", lentDate: "2026-09-25" })).toEqual({
      status: "lent_out",
      lentTo: "Ana",
      lentDate: "2026-09-25",
    });
    // Edition edit dialog: contributors by id or by name, and the REST rename
    expect(
      updateEditionSchema.parse({
        title: "À rebours",
        subtitle: null,
        isbn13: "9780140447637",
        publisherIds: [UUID],
        language: "fr",
        isFirstEdition: false,
        pageCount: 0,
        binding: "Mass Market Paperback",
        metadataLocked: false,
        contributorIds: [
          { authorId: UUID, role: "translator" },
          { authorName: "Robert Baldick", role: "translator" },
        ],
        genreIds: [],
        tagIds: [],
      }),
    ).toMatchObject({ pageCount: null, binding: expect.any(String), language: "fr" });
    expect(updateEditionSchema.parse({ title: "x", subtitle: null })).toEqual({ title: "x", subtitle: null });
    // Location card and the deactivate switch
    const location = {
      name: "Study",
      type: "physical",
      street: null,
      city: "Paris",
      region: null,
      country: "France",
      countryCode: "FR",
      postalCode: null,
      latitude: 48.85,
      longitude: 2.35,
    } as const;
    expect(updateLocationSchema.parse(location)).toEqual(location);
    expect(updateLocationSchema.parse({ isActive: false })).toEqual({ isActive: false });
    // Order edit dialog (src/app/provenance/order-edit-dialog.tsx)
    const order = {
      acquisitionMethod: "online_order",
      acquisitionTargetId: null,
      editionId: UUID,
      orderDate: "2026-09-25",
      orderConfirmation: null,
      orderUrl: null,
      price: "12.50",
      shippingCost: null,
      totalCost: "12.50",
      currency: "EUR",
      carrier: null,
      trackingNumber: null,
      trackingUrl: null,
      shippedDate: null,
      estimatedDeliveryDate: null,
      actualDeliveryDate: null,
      notes: null,
    } as const;
    expect(updateOrderSchema.parse(order)).toEqual(order);
    expect(updateWorkTaxonomySchema.parse({ themeIds: [UUID], keywordIds: [] })).toEqual({ themeIds: [UUID], keywordIds: [] });
    expect(updateTaxonomyItemSchema.parse({ color: "#7a5c61" })).toEqual({ color: "#7a5c61" });
    expect(updateTaxonomyItemSchema.parse({ parentId: null })).toEqual({ parentId: null });
  });

  it("keeps create-time rules for new rows", () => {
    expect(createWorkSchema.parse({ title: "T", authorIds: [{ authorId: UUID }] }).catalogueStatus).toBe("tracked");
    expect(() => createSubLocationSchema.parse({ locationId: "x", name: "Shelf" })).toThrow();
  });
});

describe("toUpdateSchema / parseId", () => {
  it("builds an optional, default-free, strict copy", async () => {
    const { z } = await import("zod/v4");
    const s = toUpdateSchema(z.object({ a: z.string().default("x"), b: z.number().min(1) }));
    expect(s.parse({})).toEqual({});
    expect(s.parse({ b: 2 })).toEqual({ b: 2 });
    expect(() => s.parse({ b: 0 })).toThrow();
    expect(() => s.parse({ c: 1 })).toThrow();
  });

  it("parseId accepts UUIDs only", () => {
    expect(parseId(UUID)).toBe(UUID);
    expect(() => parseId("1; drop table works")).toThrow();
    expect(() => parseId(undefined)).toThrow();
  });
});
