import { describe, expect, it } from "vitest";
import { openFailureOf } from "@/lib/ebooks/open-failure";
import { lockName, lockedFileMessage } from "@/lib/ebooks/locked-file";

describe("a file the reader could not open (SLN-685)", () => {
  it("reads the recorded failure, and nothing from metadata without one", () => {
    expect(openFailureOf({ title: "À rebours", openFailure: { reason: "zip: bad", at: "2026-10-15T20:00:00.000Z" } }))
      .toEqual({ reason: "zip: bad", at: "2026-10-15T20:00:00.000Z" });
    for (const metadata of [{}, null, [], "x", { openFailure: null }, { openFailure: { reason: 1, at: "x" } }, { openFailure: [] }])
      expect(openFailureOf(metadata)).toBeNull();
  });
});

describe("a locked file, in plain words (SLN-685)", () => {
  it("names the lock and what to do", () => {
    expect(lockedFileMessage("adobe-adept")).toBe(
      "This file is locked with Adobe DRM; Durtal can’t open it. Replace it with a DRM-free copy.",
    );
    expect(lockName("kindle")).toBe("Kindle DRM");
    expect(lockName("unknown")).toBe("DRM");
    expect(lockedFileMessage("pdf-password")).toBe(
      "This file is locked with a password; Durtal can’t open it. Replace it with a copy that has no password.",
    );
  });
});
