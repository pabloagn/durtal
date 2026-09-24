import { describe, it, expect } from "vitest";
import { createOrderSchema } from "@/lib/validations/orders";
import { createPlaceSchema } from "@/lib/validations/places";
import { createVenueSchema } from "@/lib/validations/venues";

const uuid = "550e8400-e29b-41d4-a716-446655440000";

// -- createOrderSchema --------------------------------------------------------

describe("createOrderSchema", () => {
  const validOrder = {
    workId: uuid,
    acquisitionMethod: "online_order" as const,
    orderDate: "2025-01-15",
  };

  it("accepts valid minimal order", () => {
    const result = createOrderSchema.safeParse(validOrder);
    expect(result.success).toBe(true);
  });

  it("rejects missing workId", () => {
    const { workId: _, ...noWorkId } = validOrder;
    const result = createOrderSchema.safeParse(noWorkId);
    expect(result.success).toBe(false);
  });

  it("rejects invalid acquisitionMethod", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      acquisitionMethod: "stolen",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status enum", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      status: "teleported",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid acquisition methods", () => {
    const methods = [
      "online_order",
      "in_store_purchase",
      "gift",
      "digital_purchase",
      "auction",
      "event_purchase",
    ] as const;

    for (const method of methods) {
      const result = createOrderSchema.safeParse({
        ...validOrder,
        acquisitionMethod: method,
      });
      expect(result.success, `expected '${method}' to be accepted`).toBe(true);
    }
  });

  it("accepts all valid order statuses", () => {
    const statuses = [
      "placed",
      "confirmed",
      "processing",
      "shipped",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "purchased",
      "received",
      "bid",
      "won",
      "cancelled",
      "returned",
    ] as const;

    for (const status of statuses) {
      const result = createOrderSchema.safeParse({
        ...validOrder,
        status,
      });
      expect(result.success, `expected status '${status}' to be accepted`).toBe(true);
    }
  });

  it("rejects empty orderDate", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      orderDate: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID workId", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      workId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional nullable fields as null", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      editionId: null,
      notes: null,
      price: null,
      carrier: null,
    });
    expect(result.success).toBe(true);
  });
});

// -- createPlaceSchema --------------------------------------------------------

describe("createPlaceSchema", () => {
  const validPlace = {
    name: "Buenos Aires",
    type: "city",
  };

  it("accepts valid minimal place", () => {
    const result = createPlaceSchema.safeParse(validPlace);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createPlaceSchema.safeParse({ ...validPlace, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects latitude below -90", () => {
    const result = createPlaceSchema.safeParse({
      ...validPlace,
      latitude: -91,
    });
    expect(result.success).toBe(false);
  });

  it("rejects latitude above 90", () => {
    const result = createPlaceSchema.safeParse({
      ...validPlace,
      latitude: 91,
    });
    expect(result.success).toBe(false);
  });

  it("rejects longitude below -180", () => {
    const result = createPlaceSchema.safeParse({
      ...validPlace,
      longitude: -181,
    });
    expect(result.success).toBe(false);
  });

  it("rejects longitude above 180", () => {
    const result = createPlaceSchema.safeParse({
      ...validPlace,
      longitude: 181,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid latitude and longitude at boundaries", () => {
    const result = createPlaceSchema.safeParse({
      ...validPlace,
      latitude: 90,
      longitude: -180,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null latitude and longitude", () => {
    const result = createPlaceSchema.safeParse({
      ...validPlace,
      latitude: null,
      longitude: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty type", () => {
    const result = createPlaceSchema.safeParse({ ...validPlace, type: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 500 chars", () => {
    const result = createPlaceSchema.safeParse({
      ...validPlace,
      name: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

// -- createVenueSchema --------------------------------------------------------

describe("createVenueSchema", () => {
  const validVenue = {
    name: "Shakespeare and Company",
    type: "bookshop" as const,
  };

  it("accepts valid minimal venue", () => {
    const result = createVenueSchema.safeParse(validVenue);
    expect(result.success).toBe(true);
  });

  it("rejects invalid venue type enum", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      type: "supermarket",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid venue types", () => {
    const types = [
      "bookshop",
      "online_store",
      "cafe",
      "library",
      "museum",
      "gallery",
      "auction_house",
      "market",
      "fair",
      "publisher",
      "individual",
      "other",
    ] as const;

    for (const t of types) {
      const result = createVenueSchema.safeParse({ ...validVenue, type: t });
      expect(result.success, `expected venue type '${t}' to be accepted`).toBe(true);
    }
  });

  it("rejects personalRating below 1", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      personalRating: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects personalRating above 5", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      personalRating: 6,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer personalRating", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      personalRating: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid personalRating within range", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const result = createVenueSchema.safeParse({
        ...validVenue,
        personalRating: rating,
      });
      expect(result.success, `expected rating ${rating} to be accepted`).toBe(true);
    }
  });

  it("accepts null personalRating", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      personalRating: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createVenueSchema.safeParse({ ...validVenue, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 500 chars", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      name: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      description: "A famous bookshop in Paris",
      website: "https://shakespeareandcompany.com",
      isFavorite: true,
      tags: ["paris", "english"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts placeCoordinates with valid values", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      placeCoordinates: { latitude: 48.8526, longitude: 2.3470 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects placeCoordinates with latitude outside bounds", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      placeCoordinates: { latitude: 91, longitude: 2.3470 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects placeCoordinates with longitude outside bounds", () => {
    const result = createVenueSchema.safeParse({
      ...validVenue,
      placeCoordinates: { latitude: 48.8526, longitude: 181 },
    });
    expect(result.success).toBe(false);
  });
});
