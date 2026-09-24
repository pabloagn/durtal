import { describe, it, expect } from "vitest";
import {
  TERMINAL_STATUSES,
  IN_TRANSIT_STATUSES,
  PIPELINE_STATUSES,
  AUCTION_PIPELINE,
  IMMEDIATE_PIPELINE,
  BOOK_IN_HAND_STATUSES,
  getValidTransitions,
  getValidInitialStatuses,
  type OrderStatus,
  type AcquisitionMethod,
} from "@/lib/constants/orders";

// ── Status constants ─────────────────────────────────────────────────────────

describe("TERMINAL_STATUSES", () => {
  it("contains the correct terminal statuses", () => {
    expect(TERMINAL_STATUSES).toContain("delivered");
    expect(TERMINAL_STATUSES).toContain("purchased");
    expect(TERMINAL_STATUSES).toContain("received");
    expect(TERMINAL_STATUSES).toContain("cancelled");
    expect(TERMINAL_STATUSES).toContain("returned");
  });

  it("does not contain 'won' (auction orders must advance past won)", () => {
    expect(TERMINAL_STATUSES).not.toContain("won");
  });
});

describe("BOOK_IN_HAND_STATUSES", () => {
  it("contains delivery-complete statuses", () => {
    expect(BOOK_IN_HAND_STATUSES).toEqual(["delivered", "purchased", "received"]);
  });

  it("is a subset of TERMINAL_STATUSES", () => {
    for (const status of BOOK_IN_HAND_STATUSES) {
      expect(TERMINAL_STATUSES).toContain(status);
    }
  });
});

describe("PIPELINE_STATUSES", () => {
  it("follows correct order progression", () => {
    expect(PIPELINE_STATUSES).toEqual([
      "placed", "confirmed", "processing", "shipped",
      "in_transit", "out_for_delivery", "delivered",
    ]);
  });
});

describe("AUCTION_PIPELINE", () => {
  it("starts with bid and ends with delivered", () => {
    expect(AUCTION_PIPELINE[0]).toBe("bid");
    expect(AUCTION_PIPELINE[AUCTION_PIPELINE.length - 1]).toBe("delivered");
  });

  it("includes won after bid", () => {
    const bidIdx = AUCTION_PIPELINE.indexOf("bid");
    const wonIdx = AUCTION_PIPELINE.indexOf("won");
    expect(wonIdx).toBe(bidIdx + 1);
  });
});

describe("IMMEDIATE_PIPELINE", () => {
  it("contains only purchased and received", () => {
    expect(IMMEDIATE_PIPELINE).toEqual(["purchased", "received"]);
  });
});

// ── Transition validation ────────────────────────────────────────────────────

describe("getValidTransitions", () => {
  it("returns empty array for terminal statuses", () => {
    const methods: AcquisitionMethod[] = ["online_order", "in_store_purchase", "auction", "gift"];
    for (const method of methods) {
      for (const terminal of TERMINAL_STATUSES) {
        expect(getValidTransitions(terminal, method)).toEqual([]);
      }
    }
  });

  it("allows forward transitions for online orders", () => {
    const transitions = getValidTransitions("placed", "online_order");
    expect(transitions).toContain("confirmed");
    expect(transitions).toContain("shipped");
    expect(transitions).toContain("delivered");
  });

  it("always includes cancelled and returned as options", () => {
    const transitions = getValidTransitions("placed", "online_order");
    expect(transitions).toContain("cancelled");
    expect(transitions).toContain("returned");
  });

  it("excludes current status from transitions", () => {
    const transitions = getValidTransitions("placed", "online_order");
    expect(transitions).not.toContain("placed");
  });

  it("uses auction pipeline for auction method", () => {
    const transitions = getValidTransitions("bid", "auction");
    expect(transitions).toContain("won");
    expect(transitions).not.toContain("confirmed"); // not in auction pipeline
  });

  it("uses immediate pipeline for in-store purchases", () => {
    const transitions = getValidTransitions("purchased", "in_store_purchase");
    // purchased is terminal
    expect(transitions).toEqual([]);
  });

  it("uses immediate pipeline for gifts", () => {
    const validInitial = getValidInitialStatuses("gift");
    expect(validInitial).toContain("received");
  });

  it("allows backward transitions within pipeline", () => {
    const transitions = getValidTransitions("shipped", "online_order");
    expect(transitions).toContain("placed"); // backward
    expect(transitions).toContain("delivered"); // forward
  });
});

// ── Initial status validation ────────────────────────────────────────────────

describe("getValidInitialStatuses", () => {
  it("returns bid/won for auctions", () => {
    expect(getValidInitialStatuses("auction")).toEqual(["bid", "won"]);
  });

  it("returns purchased for in-store", () => {
    expect(getValidInitialStatuses("in_store_purchase")).toEqual(["purchased"]);
  });

  it("returns purchased for event purchase", () => {
    expect(getValidInitialStatuses("event_purchase")).toEqual(["purchased"]);
  });

  it("returns received for gifts", () => {
    expect(getValidInitialStatuses("gift")).toEqual(["received"]);
  });

  it("returns pipeline start for online orders", () => {
    const statuses = getValidInitialStatuses("online_order");
    expect(statuses).toContain("placed");
    expect(statuses).toContain("confirmed");
  });

  it("returns pipeline start for digital purchases", () => {
    const statuses = getValidInitialStatuses("digital_purchase");
    expect(statuses).toContain("placed");
  });
});

// ── Cross-validation: all OrderStatus values are covered ─────────────────────

describe("status coverage", () => {
  const ALL_STATUSES: OrderStatus[] = [
    "placed", "confirmed", "processing", "shipped", "in_transit",
    "out_for_delivery", "delivered", "purchased", "received",
    "bid", "won", "cancelled", "returned",
  ];

  it("every status appears in at least one pipeline or terminal list", () => {
    const covered = new Set([
      ...TERMINAL_STATUSES,
      ...PIPELINE_STATUSES,
      ...AUCTION_PIPELINE,
      ...IMMEDIATE_PIPELINE,
    ]);
    for (const status of ALL_STATUSES) {
      expect(covered.has(status)).toBe(true);
    }
  });

  it("no status appears in both terminal and active pipelines", () => {
    const activePipeline = [...PIPELINE_STATUSES.slice(0, -1), ...AUCTION_PIPELINE.slice(0, -1)];
    // Terminal and active should not overlap except for end states
    for (const active of activePipeline) {
      if (active === "delivered") continue; // delivered is both pipeline end and terminal
      expect(TERMINAL_STATUSES).not.toContain(active);
    }
  });
});
