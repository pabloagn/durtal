import { afterEach, beforeEach, expect, it, vi } from "vitest";

let previousJitless: boolean | undefined;

beforeEach(async () => {
  vi.resetModules();
  const { config } = await import("zod/v4");
  previousJitless = config().jitless;
  config({ jitless: false });
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { config } = await import("zod/v4");
  config({ jitless: previousJitless });
  vi.resetModules();
});

it("constructs and validates the real reader tracking schema without an eval probe", async () => {
  const evaluation = vi.spyOn(globalThis, "Function").mockImplementation(() => {
    throw new EvalError("Reader CSP forbids runtime code generation");
  });
  await import("@/instrumentation-client");
  const { readerTrackingDataSchema } = await import("@/lib/reading/reader-tracking-data");
  const data = {
    version: 1,
    ebookId: "00000000-0000-4000-a000-000000000001",
    deviceId: "00000000-0000-4000-a000-000000000002",
    autoTrack: true,
    dayStartHour: 4,
    estimate: null,
    linked: null,
  };

  expect(readerTrackingDataSchema.parse(data)).toEqual(data);
  expect(readerTrackingDataSchema.safeParse({ ...data, dayStartHour: 7 }).success).toBe(false);
  expect(readerTrackingDataSchema.safeParse({ ...data, unrecognized: true }).success).toBe(false);
  expect(evaluation).not.toHaveBeenCalled();
});
