import { describe, expect, it } from "vitest";
import { copyWhereabouts, homeOptions, isAtHand, type CopyPlace } from "@/lib/reading/at-hand";
import { nextVolume } from "@/lib/reading/series";
import { pickDefaultEdition, type EditionChoice } from "@/lib/reading/defaults";

const AMS = "loc-ams";
const MEX = "loc-mex";
const KINDLE = "loc-kindle";
const copy = (over: Partial<CopyPlace & { id: string }> = {}) => ({
  id: "c1",
  status: "available",
  locationId: AMS,
  locationType: "physical",
  locationName: "Amsterdam",
  subLocationName: null as string | null,
  ...over,
});

describe("isAtHand and copyWhereabouts", () => {
  it("knows every status, a digital copy and a copy at another home", () => {
    expect(isAtHand(copy(), AMS)).toBe(true);
    expect(isAtHand(copy(), MEX)).toBe(false);
    expect(isAtHand(copy(), null)).toBe(false);
    expect(isAtHand(copy({ locationId: KINDLE, locationType: "digital" }), MEX)).toBe(true);
    for (const status of ["lent_out", "in_transit", "in_storage", "missing", "damaged", "deaccessioned"])
      expect(isAtHand(copy({ status }), AMS), status).toBe(false);
    expect(copyWhereabouts(copy({ subLocationName: "Study, shelf 3" }))).toBe("On your shelf in Amsterdam, Study, shelf 3");
    expect(copyWhereabouts(copy({ status: "lent_out", lentTo: "M.", lentDate: "2026-05-03" }), { today: "2026-10-05" })).toBe("Lent to M. since 3 May");
    expect(copyWhereabouts(copy({ status: "lent_out", lentTo: "M.", lentDate: "2025-05-03" }), { today: "2026-10-05" })).toBe("Lent to M. since 3 May 2025");
    expect(copyWhereabouts(copy({ status: "in_storage" }))).toBe("In storage");
    expect(copyWhereabouts(copy({ status: "in_transit" }))).toBe("In transit");
    expect(copyWhereabouts(copy({ status: "missing" }))).toBe("Missing");
    expect(copyWhereabouts(copy({ status: "damaged" }))).toBe("Damaged");
    expect(copyWhereabouts(copy({ locationType: "digital", locationName: "Kindle" }))).toBe("Digital");
  });
  it("offers only physical, active places as a home", () => {
    const places = [
      { id: AMS, name: "Amsterdam", type: "physical", isActive: true },
      { id: "old", name: "Old flat", type: "physical", isActive: false },
      { id: KINDLE, name: "Kindle", type: "digital", isActive: true },
    ];
    expect(homeOptions(places).map((p) => p.id)).toEqual([AMS]);
  });
});

describe("nextVolume", () => {
  const v = (id: string, position: string | null, finished = false) => ({ id, title: `Volume ${id}`, position, finished });
  it("follows the series order after the last finished volume", () => {
    expect(nextVolume([v("2", "2"), v("1", "1")])?.id).toBe("1");
    expect(nextVolume([v("1", "1", true), v("2", "2"), v("3", "3", true), v("4", "4")])?.id).toBe("4");
    expect(nextVolume([v("1", "1", true), v("2", "2", true)])).toBeNull();
    expect(nextVolume([v("10", "10"), v("2", "2")])?.id).toBe("2");
    expect(nextVolume([v("x", null), v("1", "1", true)])?.id).toBe("x");
    expect(nextVolume([v("x", null), v("3", "3")])?.id).toBe("3");
  });
});

describe("pickDefaultEdition", () => {
  const ed = (id: string, copies: EditionChoice["copies"] = [], pageCount: number | null = null): EditionChoice => ({ id, pageCount, copies });
  const none = { homeId: AMS, lastReadingEditionId: null };
  it("takes a physical copy at hand at the home first", () => {
    const editions = [ed("e1", [copy({ id: "k", locationId: KINDLE, locationType: "digital" })]), ed("e2", [copy({ id: "p" })])];
    expect(pickDefaultEdition(editions, none)).toEqual({ editionId: "e2", instanceId: "p" });
  });
  it("takes a digital copy when the home has no physical copy at hand", () => {
    const editions = [ed("e1", [copy({ id: "lent", status: "lent_out" })]), ed("e2", [copy({ id: "k", locationId: KINDLE, locationType: "digital" })])];
    expect(pickDefaultEdition(editions, none)).toEqual({ editionId: "e2", instanceId: "k" });
  });
  it("then the edition of the last reading, an owned edition, one with a page count, the first", () => {
    const away = { homeId: MEX, lastReadingEditionId: "e2" };
    expect(pickDefaultEdition([ed("e1", [copy({ id: "a" })]), ed("e2")], away)).toEqual({ editionId: "e2", instanceId: null });
    expect(pickDefaultEdition([ed("e1"), ed("e2", [copy({ id: "b", status: "lent_out" })])], { homeId: MEX, lastReadingEditionId: null })).toEqual({
      editionId: "e2",
      instanceId: "b",
    });
    expect(pickDefaultEdition([ed("e1", [copy({ id: "d", status: "deaccessioned" })]), ed("e2", [], 300)], none)).toEqual({ editionId: "e2", instanceId: null });
    expect(pickDefaultEdition([ed("e1"), ed("e2")], none)).toEqual({ editionId: "e1", instanceId: null });
    expect(pickDefaultEdition([], none)).toEqual({ editionId: null, instanceId: null });
  });
  it("prefers an available copy as the default copy", () => {
    const e = ed("e1", [copy({ id: "lent", status: "lent_out", locationId: MEX }), copy({ id: "store", status: "in_storage" }), copy({ id: "ok", locationId: MEX })]);
    expect(pickDefaultEdition([e], { homeId: null, lastReadingEditionId: null })).toEqual({ editionId: "e1", instanceId: "ok" });
  });
});
