import { afterEach, describe, expect, it, vi } from "vitest";
import { serverEnv } from "@/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("serverEnv", () => {
  it("lists every missing required variable in one error", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    expect(() => serverEnv()).toThrow(
      /DATABASE_URL: must be a Postgres connection URL\n {2}- AWS_ACCESS_KEY_ID: is required/,
    );
  });

  it("applies defaults for the region and bucket", () => {
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("S3_BUCKET", "");
    expect(serverEnv()).toMatchObject({ AWS_REGION: "us-east-1", S3_BUCKET: "durtal" });
  });

  it("prefers ISBNDB_API_KEY and still accepts the old misspelled name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ISBNDB_API_KEY", "");
    vi.stubEnv("ISBNDN_API_KEY", "old");
    expect(serverEnv().ISBNDB_API_KEY).toBe("old");
    expect(warn).toHaveBeenCalledOnce();

    vi.stubEnv("ISBNDB_API_KEY", "new");
    expect(serverEnv().ISBNDB_API_KEY).toBe("new");
  });
});
