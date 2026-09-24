import { describe, it, expect } from "vitest";
import {
  isAllowedImageType,
  isSafeUrl,
  ALLOWED_IMAGE_TYPES,
  MAX_MEDIA_SIZE_BYTES,
} from "@/lib/validations/media-security";

// -- isAllowedImageType -------------------------------------------------------

describe("isAllowedImageType", () => {
  it("accepts image/jpeg", () => {
    expect(isAllowedImageType("image/jpeg")).toBe(true);
  });

  it("accepts image/png", () => {
    expect(isAllowedImageType("image/png")).toBe(true);
  });

  it("accepts image/webp", () => {
    expect(isAllowedImageType("image/webp")).toBe(true);
  });

  it("accepts image/gif", () => {
    expect(isAllowedImageType("image/gif")).toBe(true);
  });

  it("accepts content type with charset parameter", () => {
    expect(isAllowedImageType("image/jpeg; charset=utf-8")).toBe(true);
  });

  it("accepts uppercase content type", () => {
    expect(isAllowedImageType("IMAGE/PNG")).toBe(true);
  });

  it("rejects application/javascript", () => {
    expect(isAllowedImageType("application/javascript")).toBe(false);
  });

  it("rejects text/html", () => {
    expect(isAllowedImageType("text/html")).toBe(false);
  });

  it("rejects application/pdf", () => {
    expect(isAllowedImageType("application/pdf")).toBe(false);
  });

  it("rejects image/svg+xml", () => {
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isAllowedImageType("")).toBe(false);
  });
});

// -- isSafeUrl ----------------------------------------------------------------

describe("isSafeUrl", () => {
  it("accepts a valid HTTPS URL", () => {
    expect(isSafeUrl("https://example.com/image.jpg")).toBe(true);
  });

  it("accepts HTTPS URL with subdomain path", () => {
    expect(isSafeUrl("https://books.google.com/cover.jpg")).toBe(true);
  });

  it("rejects plain HTTP (no HTTPS)", () => {
    expect(isSafeUrl("http://example.com")).toBe(false);
  });

  it("rejects file:// protocol", () => {
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects https://localhost", () => {
    expect(isSafeUrl("https://localhost/img.jpg")).toBe(false);
  });

  it("rejects https://127.0.0.1", () => {
    expect(isSafeUrl("https://127.0.0.1/img.jpg")).toBe(false);
  });

  it("rejects private IP 10.x.x.x", () => {
    expect(isSafeUrl("https://10.0.0.1/img.jpg")).toBe(false);
  });

  it("rejects private IP 192.168.x.x", () => {
    expect(isSafeUrl("https://192.168.1.1/img.jpg")).toBe(false);
  });

  it("rejects private IP 172.16.x.x", () => {
    expect(isSafeUrl("https://172.16.0.1/img.jpg")).toBe(false);
  });

  it("rejects .local hostname", () => {
    expect(isSafeUrl("https://host.local/img.jpg")).toBe(false);
  });

  it("rejects .internal hostname", () => {
    expect(isSafeUrl("https://host.internal/img.jpg")).toBe(false);
  });

  it("rejects invalid URL string", () => {
    expect(isSafeUrl("invalid-not-a-url")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeUrl("")).toBe(false);
  });
});

// -- Constants ----------------------------------------------------------------

describe("constants", () => {
  it("MAX_MEDIA_SIZE_BYTES equals 50 MB", () => {
    expect(MAX_MEDIA_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("ALLOWED_IMAGE_TYPES has exactly 4 entries", () => {
    expect(ALLOWED_IMAGE_TYPES.size).toBe(4);
  });
});
