import { describe, expect, it } from "vitest";
import {
  WORK_RELATION_LABELS,
  WORK_RELATION_TYPES,
  relationAllowed,
  relationNeedsSource,
  relationTargetKinds,
} from "@/lib/catalogue/work-relations";

const ALL = ["book", "film", "perfume", "painting"] as const;

describe("links between works", () => {
  it("joins only the kinds each type allows, in the direction it reads", () => {
    expect(relationAllowed("adaptation", "film", "book")).toBe(true);
    expect(relationAllowed("adaptation", "book", "film")).toBe(true);
    expect(relationAllowed("adaptation", "book", "book")).toBe(false);
    expect(relationAllowed("remake", "film", "film")).toBe(true);
    expect(relationAllowed("remake", "film", "book")).toBe(false);
    expect(relationAllowed("flanker", "perfume", "perfume")).toBe(true);
    expect(relationAllowed("flanker", "film", "film")).toBe(false);
    for (const from of ALL) for (const to of ALL) expect(relationAllowed("inspiration", from, to)).toBe(true);
  });

  it("offers the other end's kinds from each side", () => {
    expect(relationTargetKinds("adaptation", "film", "outgoing")).toEqual(["book"]);
    expect(relationTargetKinds("adaptation", "book", "incoming")).toEqual(["film"]);
    expect(relationTargetKinds("adaptation", "perfume", "outgoing")).toEqual([]);
    expect(relationTargetKinds("remake", "film", "incoming")).toEqual(["film"]);
    expect(relationTargetKinds("inspiration", "perfume", "outgoing")).toEqual(["book", "perfume", "film", "painting"]);
  });

  it("reads each link from both ends, and asks a source only of an inspiration", () => {
    expect(WORK_RELATION_LABELS.adaptation).toEqual({ outgoing: "Adapted from", incoming: "Adapted as" });
    expect(WORK_RELATION_TYPES.filter(relationNeedsSource)).toEqual(["inspiration"]);
  });
});
