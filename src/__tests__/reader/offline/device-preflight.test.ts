import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reader/device/route";
import { DEVICE } from "./fixtures";

describe("read-only device preflight", () => {
  it.each([DEVICE, null, "forged"])(
    "reads only an existing valid cookie: %s",
    async (cookie) => {
      const result = await GET(
        new NextRequest("http://localhost/api/reader/device", {
          headers: cookie ? { cookie: `durtal-device=${cookie}` } : {},
        }),
      );
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({
        deviceId: cookie === DEVICE ? DEVICE : null,
      });
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.headers.get("set-cookie")).toBeNull();
    },
  );
  it("refuses cross-origin requests with no cookie mutation or cache", async () => {
    const result = await GET(
      new NextRequest("http://localhost/api/reader/device", {
        headers: {
          "sec-fetch-site": "cross-site",
          cookie: `durtal-device=${DEVICE}`,
        },
      }),
    );
    expect(result.status).toBe(403);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("set-cookie")).toBeNull();
  });
});
