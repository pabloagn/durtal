import { expect, it } from "vitest";
import { deviceClass } from "@/lib/reader/presentation/device-class";

it.each([
  [1600, 599, false, "phone"],
  [1600, 600, false, "tablet"],
  [1600, 1099, false, "tablet"],
  [1600, 1100, false, "desktop"],
  [844, 390, false, "phone"],
  [390, 844, true, "phone"],
  [1366, 1024, false, "tablet"],
  [1440, 900, false, "tablet"],
  [1440, 900, true, "tablet"],
  [1600, 1200, true, "tablet"],
  [1100, 1600, false, "desktop"],
])("classifies %d × %d, coarse %s as %s", (width, height, coarse, expected) => {
  expect(deviceClass({ width, height, coarse })).toBe(expected);
});

it.each([0, -1, NaN, Infinity])(
  "refuses an invalid viewport dimension %s",
  (value) => {
    expect(() =>
      deviceClass({ width: value, height: 1000, coarse: false }),
    ).toThrow(RangeError);
    expect(() =>
      deviceClass({ width: 1000, height: value, coarse: false }),
    ).toThrow(RangeError);
  },
);
