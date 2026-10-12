import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readerUuid } from "@/lib/reader/uuid";
import { isDeviceId } from "@/lib/reader/device";
import { isUuid } from "@/lib/utils/uuid";

const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("reader UUID capability", () => {
  it("uses the real native UUID implementation when available", () => {
    vi.stubGlobal("crypto", webcrypto);
    expect(readerUuid()).toMatch(v4);
  });
  it("calls native randomUUID with its receiver and leaves fallback entropy unused", () => {
    const expected = "af5d0a23-1275-47ed-8a3c-16db74748daa";
    let receiver: unknown;
    const native = vi.fn(function (this: unknown) { receiver = this; return expected; });
    const entropy = vi.fn(() => { throw new Error("Fallback should not run"); });
    const provider = { randomUUID: native, getRandomValues: entropy };
    vi.stubGlobal("crypto", provider);
    expect(readerUuid()).toBe(expected);
    expect(receiver).toBe(provider);
    expect(native).toHaveBeenCalledTimes(1);
    expect(entropy).not.toHaveBeenCalled();
  });
  it("generates fresh v4 IDs from real CSPRNG entropy with no randomUUID or subtle", () => {
    const entropy = vi.fn((bytes: Uint8Array<ArrayBuffer>) => webcrypto.getRandomValues(bytes));
    vi.stubGlobal("crypto", { getRandomValues: entropy });
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Non-cryptographic entropy forbidden"); });
    const ids = Array.from({ length: 32 }, () => readerUuid());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(v4);
      expect(isUuid(id)).toBe(true);
      expect(isDeviceId(id)).toBe(true);
    }
    expect(entropy).toHaveBeenCalledTimes(ids.length);
    for (const [bytes] of entropy.mock.calls) {
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.byteLength).toBe(16);
    }
  });
  it.each([
    { input: Uint8Array.from({ length: 16 }, (_, index) => index), expected: "00010203-0405-4607-8809-0a0b0c0d0e0f" },
    { input: new Uint8Array(16).fill(255), expected: "ffffffff-ffff-4fff-bfff-ffffffffffff" },
  ])("sets version and variant bits without changing other random bits", ({ input, expected }) => {
    let receiver: unknown;
    const entropy = vi.fn(function (this: unknown, bytes: Uint8Array) {
      receiver = this; bytes.set(input); return bytes;
    });
    const provider = { getRandomValues: entropy };
    vi.stubGlobal("crypto", provider);
    expect(readerUuid()).toBe(expected);
    expect(receiver).toBe(provider);
    expect(entropy).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, {}, { getRandomValues: undefined, randomUUID: undefined }])(
    "refuses missing cryptographic entropy explicitly", provider => {
      vi.stubGlobal("crypto", provider);
      const insecure = vi.spyOn(Math, "random");
      expect(() => readerUuid()).toThrow("Secure random values are unavailable for reader identities.");
      expect(insecure).not.toHaveBeenCalled();
    },
  );
  it("propagates an entropy failure without generating an identity", () => {
    const failure = new Error("Entropy provider refused");
    vi.stubGlobal("crypto", { getRandomValues: () => { throw failure; } });
    expect(() => readerUuid()).toThrow(failure);
  });
  it("preserves native failures instead of silently taking the fallback", () => {
    const failure = new Error("Native provider refused");
    const entropy = vi.fn();
    vi.stubGlobal("crypto", { randomUUID: () => { throw failure; }, getRandomValues: entropy });
    expect(() => readerUuid()).toThrow(failure);
    expect(entropy).not.toHaveBeenCalled();
  });
});
