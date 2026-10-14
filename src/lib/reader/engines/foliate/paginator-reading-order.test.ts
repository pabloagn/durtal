// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { getNavigationExcludedViews, retireNonlinearNavigationViews, getAdjacentLinearIndex, getStripNeighbourIndex } from "@/vendor/foliate-js/paginator.js";

describe("visited nonlinear frames and the linear reading strip", () => {
  const sections = [{ id: "preface" }, { id: "book" }, { id: "notes", linear: "no" }];
  it("retires the native Notes cache on return to100%, leaving next bounded by reading order", () => {
    // Recorded R14 contents: [0,1] at Page30, [0,1,2] after the Notes link
    // and after100%, followed by a wrong ArrowRight landing at index2.
    // These are cache/reading-order contracts, not invented range geometry.
    expect(getNavigationExcludedViews(sections, 2, [0,1,2])).toEqual([]);
    const retire = getNavigationExcludedViews(sections, 1, [0,1,2]);
    expect(retire).toEqual([2]);
    const cached = new Map([[0,{id:"preface"}],[1,{id:"book"}],[2,{id:"notes"}]]);
    retireNonlinearNavigationViews(sections, 1, cached.keys(), (index: number) => { cached.delete(index); });
    expect([...cached.keys()]).toEqual([0,1]);
    expect(getAdjacentLinearIndex(sections, 1, 1)).toBeUndefined();
    expect(getAdjacentLinearIndex(sections, 1, -1)).toBe(0);
    // The actual reuse branch destroys these indexes; the load branch removes
    // them from its keep set before calculating the destination's offsets.
    expect(retire).not.toContain(1);
  });
  it("preserves the linear origin frame and exact CFI when retiring an off-order visit", () => {
    const origin = { cfi: "epubcfi(/6/4!/4,/178/1:253,/186/1:85)" };
    const note = { cfi: "epubcfi(/6/6!/4,/2[note],/6/2/1:16)" };
    const cached = new Map([[1,origin],[2,note]]);
    const retire = getNavigationExcludedViews(sections, 1, cached.keys());
    expect(retire).toEqual([2]);
    retireNonlinearNavigationViews(sections, 1, cached.keys(), (index: number) => { cached.delete(index); });
    expect(cached.has(2)).toBe(false);
    expect(cached.get(1)).toBe(origin);
    expect(origin.cfi).toBe("epubcfi(/6/4!/4,/178/1:253,/186/1:85)");
  });
  it("keeps explicit nonlinear link/history destinations admissible and their previous linear return", () => {
    expect(getNavigationExcludedViews(sections, 2, [0,1,2])).toEqual([]);
    expect(getNavigationExcludedViews(sections, 2, [0,1])).toEqual([]);
    const retired: number[] = [];
    retireNonlinearNavigationViews(sections, 2, [0,1,2], (index: number) => { retired.push(index); });
    expect(retired).toEqual([]);
    expect(getAdjacentLinearIndex(sections, 2, -1)).toBe(1);
    // Returning to the same saved linear anchor excludes only the note frame;
    // a later explicit note destination remains allowed to load it again.
    expect(getNavigationExcludedViews(sections, 1, [0,1,2])).toEqual([2]);
    expect(getNavigationExcludedViews(sections, 2, [0,1])).toEqual([]);
  });
  it("removes leading, intervening and trailing nonlinear caches without dropping a linear neighbor", () => {
    const spine = [{linear:"no"},{id:"first"},{linear:"no"},{id:"last"},{linear:"no"}];
    expect(getNavigationExcludedViews(spine, 1, [0,1,2,3,4])).toEqual([0,2,4]);
    expect(getNavigationExcludedViews(spine, 3, [0,1,2,3,4])).toEqual([0,2,4]);
    expect(getAdjacentLinearIndex(spine, 1, -1)).toBeUndefined();
    expect(getAdjacentLinearIndex(spine, 1, 1)).toBe(3);
    expect(getAdjacentLinearIndex(spine, 3, -1)).toBe(1);
    expect(getAdjacentLinearIndex(spine, 3, 1)).toBeUndefined();
  });
  it("keeps ordinary linear cache reuse and sequential first/last behavior", () => {
    expect(getNavigationExcludedViews(sections, 1, [0,1])).toEqual([]);
    expect(getNavigationExcludedViews(sections, 0, [0,1])).toEqual([]);
    expect(getAdjacentLinearIndex(sections, -1, 1)).toBe(0);
    expect(getAdjacentLinearIndex(sections, 0, -1)).toBeUndefined();
    expect(getAdjacentLinearIndex(sections, 0, 1)).toBe(1);
    expect(getAdjacentLinearIndex(sections, 1, 1)).toBeUndefined();
  });
  it("changes no nonlinear destination policy even when several off-order frames were visited", () => {
    const spine = [{id:"book"},{linear:"no"},{linear:"no"}];
    expect(getNavigationExcludedViews(spine, 2, [0,1,2])).toEqual([]);
    expect(getNavigationExcludedViews(spine, 0, [0,1,2])).toEqual([1,2]);
    expect(getAdjacentLinearIndex(spine, 0, 1)).toBeUndefined();
  });
  it("lets notes opened from a link stand alone in the loaded strip, while turns out of them still reach reading order", () => {
    // Fixture 20: Chapitre I ends on a left page, so chained after it the
    // notes began in its last spread and the next settle reported Chapitre I
    expect(getStripNeighbourIndex(sections, 2, -1)).toBeUndefined();
    expect(getStripNeighbourIndex(sections, 2, 1)).toBeUndefined();
    expect(getAdjacentLinearIndex(sections, 2, -1)).toBe(1);
    const spine = [{ id: "first" }, { linear: "no" }, { id: "last" }];
    expect(getStripNeighbourIndex(spine, 1, 1)).toBeUndefined();
    expect(getStripNeighbourIndex(spine, 0, 1)).toBe(2);
    expect(getStripNeighbourIndex(spine, 2, -1)).toBe(0);
  });
});
