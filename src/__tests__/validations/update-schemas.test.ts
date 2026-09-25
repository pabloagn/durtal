import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import { parseId, toUpdateSchema } from "@/lib/validations/helpers";
import { createWorkSchema, updateWorkSchema } from "@/lib/validations/works";
import { updateAuthorSchema } from "@/lib/validations/authors";
import { updateEditionSchema } from "@/lib/validations/editions";
import { updateInstanceSchema } from "@/lib/validations/instances";
import { updateLocationSchema, updateSubLocationSchema, createSubLocationSchema } from "@/lib/validations/locations";
import { updateOrderSchema, orderStatusSchema } from "@/lib/validations/orders";
import { updateVenueSchema } from "@/lib/validations/venues";
import { updateCollectionSchema, createCollectionSchema } from "@/lib/validations/collections";
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
  updateCollectionSchema,
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

  it("regression: renaming a taxonomy family keeps its entity level and hierarchy", () => {
    expect(updateTaxonomyFamilySchema.parse({ name: "x" })).toEqual({ name: "x" });
  });

  it("still validates values", () => {
    expect(() => updateWorkSchema.parse({ catalogueStatus: "owned" })).toThrow();
    expect(() => updateWorkSchema.parse({ rating: 6 })).toThrow();
    expect(() => updateWorkSchema.parse({ seriesId: "not-a-uuid" })).toThrow();
    expect(() => updateWorkSchema.parse({ slug: "hijack" })).toThrow();
    expect(() => updateAuthorSchema.parse({ website: "not a url" })).toThrow();
    expect(() => updateEditionSchema.parse({ isbn13: "123" })).toThrow();
    expect(() => updateEditionSchema.parse({ workId: UUID })).toThrow(); // cannot move to another work
    expect(() => updateInstanceSchema.parse({ status: "gone" })).toThrow();
    expect(() => updateInstanceSchema.parse({ editionId: UUID })).toThrow();
    expect(() => updateLocationSchema.parse({ type: "cloud" })).toThrow();
    expect(() => updateOrderSchema.parse({ status: "lost" })).toThrow();
    expect(() => orderStatusSchema.parse("lost")).toThrow();
    expect(() => updateWorkTaxonomySchema.parse({ themeIds: ["x"] })).toThrow();
    expect(() => updateCollectionSchema.parse({ posterS3Key: "private/secret.pdf" })).toThrow();
  });

  it("accepts the payloads the app sends", () => {
    expect(updateWorkSchema.parse({ rating: null, catalogueStatus: "wanted", authorIds: [{ authorId: UUID, role: "author" }] })).toEqual({
      rating: null,
      catalogueStatus: "wanted",
      authorIds: [{ authorId: UUID, role: "author" }],
    });
    expect(updateInstanceSchema.parse({ status: "lent_out", lentTo: "Ana", lentDate: "2026-09-25" })).toEqual({
      status: "lent_out",
      lentTo: "Ana",
      lentDate: "2026-09-25",
    });
    expect(updateLocationSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateCollectionSchema.parse({ posterS3Key: "gold/media/collection/x/poster/y.webp", backgroundS3Key: null })).toEqual({
      posterS3Key: "gold/media/collection/x/poster/y.webp",
      backgroundS3Key: null,
    });
    expect(updateWorkTaxonomySchema.parse({ themeIds: [UUID], keywordIds: [] })).toEqual({ themeIds: [UUID], keywordIds: [] });
  });

  it("keeps create-time rules for new rows", () => {
    expect(createWorkSchema.parse({ title: "T", authorIds: [{ authorId: UUID }] }).catalogueStatus).toBe("tracked");
    expect(() => createCollectionSchema.parse({ name: "" })).toThrow();
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
