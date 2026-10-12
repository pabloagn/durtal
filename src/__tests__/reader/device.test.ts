import { describe, expect, it } from "vitest";
import { deviceLabelFor, isDeviceId } from "@/lib/reader/device";
import { readerLatinFace } from "@/lib/reader/fonts";
import { READER_DEFAULTS, readerSettings } from "@/lib/reader/settings-cookie";

/* SLN-492: this device's id and label, and the settings the reader opens with */

describe("deviceLabelFor", () => {
  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "iPhone · Safari",
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
      "iPad · Chrome",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Mac · Firefox",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Mac · Chrome",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0",
      "Windows · Edge",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
      "Android · Chrome",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Safari/537.36",
      "Android · Samsung Internet",
    ],
    ["curl/8.5.0", "Browser"],
    [null, "Browser"],
  ])("labels %s", (ua, label) => {
    expect(deviceLabelFor(ua)).toBe(label);
  });
});

describe("isDeviceId", () => {
  it("takes only a lowercase uuid", () => {
    expect(isDeviceId("0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10")).toBe(true);
    expect(isDeviceId("0B7C6F0E-6A55-4A3E-9D33-1F1E7C2B9A10")).toBe(false);
    expect(isDeviceId("device")).toBe(false);
    expect(isDeviceId(undefined)).toBe(false);
  });
});

describe("reader settings", () => {
  it("keeps offered values and gives the default for the rest", () => {
    expect(
      readerSettings({
        fontFamily: "serif",
        fontSize: 22,
        lineHeight: 9,
        margin: "wide",
      }),
    ).toEqual({
      ...READER_DEFAULTS,
      fontFamily: "serif",
      fontSize: 22,
    });
    expect(readerSettings("garbage")).toEqual(READER_DEFAULTS);
    expect(readerSettings(null)).toEqual(READER_DEFAULTS);
  });

  it("preloads the reading font's Latin file, and none for the system or the book's own", () => {
    expect(readerLatinFace("sans")).toBe(
      "/fonts/reader/inter-normal-latin.woff2",
    );
    expect(readerLatinFace("serif")).toBe(
      "/fonts/reader/eb-garamond-normal-latin.woff2",
    );
    expect(readerLatinFace("system")).toBeNull();
    expect(readerLatinFace("publisher")).toBeNull();
  });
});

it("uses a bounded touch hint only for Macintosh labels and shares the beacon/fetch URL", async () => {
  const { positionUrl } = await import("@/lib/reader/device");
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15";
  expect(deviceLabelFor(ua)).toBe("Mac · Safari");
  expect(deviceLabelFor(ua, true)).toBe("iPad · Safari");
  expect(deviceLabelFor("curl", true)).toBe("Browser");
  expect(positionUrl("book", { userAgent: ua, maxTouchPoints: 5 })).toBe(
    "/api/reader/book/position?touch=1",
  );
  expect(positionUrl("book", { userAgent: ua, maxTouchPoints: 0 })).toBe(
    "/api/reader/book/position",
  );
});
