import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  perfumeVariantSchema,
  perfumeBottleSchema,
} from "@/lib/catalogue/perfumes";

describe("perfume model inputs", () => {
  const bottle = {
    variantId: randomUUID(),
    container: "sample",
    capacityValue: 0.0005,
    volumeUnit: "l",
    remainingMl: 0.5,
  };
  it("preserves unknown formulation and valid tiny samples", () => {
    expect(perfumeVariantSchema.parse({ workId: randomUUID() })).toMatchObject({
      concentration: null,
      formulationLabel: null,
    });
    expect(perfumeBottleSchema.parse(bottle)).toMatchObject(bottle);
    expect(
      perfumeBottleSchema.parse({ ...bottle, remainingMl: 0 }),
    ).toMatchObject({ remainingMl: 0 });
  });
  it.each([
    { remainingMl: 0.6 },
    { remainingMl: -1 },
    { capacityValue: 0 },
    { capacityValue: Infinity },
    { volumeUnit: "oz" },
    { remainingMl: 0.0001 },
    { acquisitionPrice: 10 },
    { dispositionReason: "Sold" },
    { subLocationId: randomUUID() },
  ])("rejects invalid containers: %j", (changes) => {
    expect(
      perfumeBottleSchema.safeParse({ ...bottle, ...changes }).success,
    ).toBe(false);
  });
  it("rejects bottle-size fields in variants and requires a label for other concentrations", () => {
    expect(
      perfumeVariantSchema.safeParse({
        workId: randomUUID(),
        capacityValue: 100,
      }).success,
    ).toBe(false);
    expect(
      perfumeVariantSchema.safeParse({
        workId: randomUUID(),
        concentration: "other",
      }).success,
    ).toBe(false);
  });
});
