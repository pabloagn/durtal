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

  it("needs nothing for the app's own e-book delivery, and defaults the e-book bucket", () => {
    vi.stubEnv("AWS_REGION", "eu-north-1");
    expect(serverEnv()).toMatchObject({
      EBOOK_DELIVERY: "app",
      EBOOKS_BUCKET: "durtal-ebooks",
      EBOOKS_PREFIX: "",
      EBOOKS_REGION: "eu-north-1",
    });
    vi.stubEnv("EBOOKS_REGION", "eu-central-1");
    vi.stubEnv("EBOOKS_PREFIX", "ebooks/");
    expect(serverEnv()).toMatchObject({ EBOOKS_REGION: "eu-central-1", EBOOKS_PREFIX: "ebooks/" });
  });

  it("stops EBOOK_DELIVERY=cloudfront with one message naming each missing CDN variable", () => {
    vi.stubEnv("EBOOK_DELIVERY", "cloudfront");
    vi.stubEnv("EBOOK_CDN_URL", "https://d111111abcdef8.cloudfront.net");
    expect(() => serverEnv()).toThrow(/EBOOK_DELIVERY: cloudfront needs EBOOK_CDN_KEY_PAIR_ID, EBOOK_CDN_PRIVATE_KEY/);
    vi.stubEnv("EBOOK_CDN_KEY_PAIR_ID", "K2JCJMDEHXQW5F");
    vi.stubEnv("EBOOK_CDN_PRIVATE_KEY", Buffer.from("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n").toString("base64"));
    expect(serverEnv().EBOOK_DELIVERY).toBe("cloudfront");
  });

  it("refuses a malformed e-book prefix, delivery, CDN address or key", () => {
    for (const [name, value] of [
      ["EBOOKS_PREFIX", "ebooks"],
      ["EBOOKS_PREFIX", "/ebooks/"],
      ["EBOOKS_PREFIX", "a/../"],
      ["EBOOK_DELIVERY", "s3"],
      ["EBOOK_CDN_URL", "http://d111111abcdef8.cloudfront.net"],
      ["EBOOK_CDN_PRIVATE_KEY", "not a key"],
    ]) {
      vi.stubEnv(name, value);
      expect(() => serverEnv(), `${name}=${value}`).toThrow(new RegExp(name));
      vi.unstubAllEnvs();
    }
  });
});
