import { describe, expect, it } from "vitest";
import { viewedUploadState } from "@/lib/ebooks/upload-core/store";

describe("the state an upload shows (SLN-672)", () => {
  it("shows a received file as being checked until its inspection receipt exists", () => {
    expect(viewedUploadState({ state: "ready", receipt: null })).toBe("processing");
    expect(viewedUploadState({ state: "ready", receipt: { version: 1 } })).toBe("ready");
  });
  it("leaves every other state as it is", () => {
    for (const state of ["queued", "admitted", "receiving", "processing", "quiescing", "completed", "failed", "canceled", "expired"] as const)
      expect(viewedUploadState({ state, receipt: null })).toBe(state);
  });
});
