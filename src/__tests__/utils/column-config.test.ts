import { describe, expect, it } from "vitest";
import { withNewColumns } from "@/lib/utils/column-config";

const all = [
  { key: "name", defaultVisible: true, defaultOrder: 0 },
  { key: "years", defaultVisible: true, defaultOrder: 1 },
  { key: "bio", defaultVisible: false, defaultOrder: 2 },
  { key: "roles", defaultVisible: true, defaultOrder: 10 },
];

describe("a saved column choice", () => {
  it("picks up a column added since, after the saved ones, visible by default", () => {
    const saved = [
      { key: "years", visible: true, order: 0 },
      { key: "name", visible: true, order: 1 },
      { key: "bio", visible: false, order: 2 },
    ];
    expect(withNewColumns(saved, all)).toEqual([...saved, { key: "roles", visible: true, order: 3 }]);
  });

  it("keeps the saved choice as it is, and drops a column the table no longer has", () => {
    const saved = [
      { key: "name", visible: false, order: 3 },
      { key: "gone", visible: true, order: 0 },
      { key: "years", visible: true, order: 1 },
      { key: "bio", visible: true, order: 2 },
      { key: "roles", visible: false, order: 4 },
    ];
    expect(withNewColumns(saved, all)).toEqual(saved.filter((c) => c.key !== "gone"));
  });
});
