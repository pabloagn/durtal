import { describe, expect, it } from "vitest";
import {
  isDifferentPlace,
  newestPlace,
  placeToOffer,
} from "@/lib/reader/sync/places";
import { place } from "./fixtures/places";
describe("cross-device places", () => {
  const own = place();
  const at = (section: number, progression: number) =>
    place({ locator: { ...own.locator, sectionIndex: section, progression } });
  it("ignores the same page and near pages, including exact boundaries", () => {
    expect(isDifferentPlace(own, own)).toBe(false);
    expect(isDifferentPlace(own, at(1, 0.21))).toBe(false);
    expect(isDifferentPlace(own, at(1, 0.22))).toBe(false);
    expect(isDifferentPlace(own, at(1, 0.22001))).toBe(true);
    expect(isDifferentPlace(own, at(2, 0.2))).toBe(true);
  });
  it("compares only total progression across different formats", () => {
    const pdf = place({
      fileId: "pdf",
      locator: {
        ...own.locator,
        sectionIndex: 200,
        progression: 1,
        totalProgression: 0.405,
      },
    });
    expect(isDifferentPlace(own, pdf)).toBe(false);
    expect(
      isDifferentPlace(own, {
        ...pdf,
        locator: { ...pdf.locator, totalProgression: 0.40501 },
      }),
    ).toBe(true);
  });
  it("offers only the newest other device, strictly newer and different", () => {
    const olderDifferent = place({
      thisDevice: false,
      locator: at(3, 0.5).locator,
      clientUpdatedAt: "2026-10-09T11:00:00Z",
    });
    const newestSame = place({
      thisDevice: false,
      clientUpdatedAt: "2026-10-09T12:00:00Z",
    });
    expect(placeToOffer(own, [olderDifferent])).toBe(olderDifferent);
    expect(placeToOffer(own, [olderDifferent, newestSame])).toBeNull();
    expect(
      placeToOffer(own, [
        { ...olderDifferent, clientUpdatedAt: own.clientUpdatedAt },
      ]),
    ).toBeNull();
    expect(
      placeToOffer(own, [place({ clientUpdatedAt: "2026-10-09T13:00:00Z" })]),
    ).toBeNull();
  });
  it("a never-opened device starts at the newest place", () => {
    const other = place({ thisDevice: false });
    expect(placeToOffer(null, [other])).toBe(other);
    expect(newestPlace([])).toBeNull();
  });
});
