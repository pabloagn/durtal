import { describe, expect, it } from "vitest";
import { projectUploadItem } from "@/lib/ebooks/upload-core/store";
import { checkedItemView, quarantineMessage, UNREADABLE_CHECK_MESSAGE } from "@/lib/ebooks/upload-core/refusal";
import { validationFor } from "@/lib/ebooks/medallion";
import { coreOperationFixture } from "./operation-fixture";

// SLN-1388: a refused or failed file said only "Needs attention", and a damaged,
// locked or unchecked one "retained for review", naming neither file nor problem
const failed = (jobFailureV1: unknown, generation = 1) =>
  projectUploadItem(coreOperationFixture({ state: "failed", generation, progress: jobFailureV1 === undefined ? {} : { jobFailureV1 } }));

describe("a failed upload's row", () => {
  it("says the file is not an e-book, and that trying again won't help", () => {
    const item = failed({ generation: 1, code: "upload_job_failed", reason: "not_an_ebook", what: "PNG image" });
    expect(item).toMatchObject({ state: "failed", message: "Not added: not an e-book (PNG image).", refused: true });
  });
  it("says a check that failed can be tried again", () => {
    const item = failed({ generation: 1, code: "upload_job_failed", reason: "check_failed", what: null });
    expect(item).toMatchObject({ message: "Not added: the file couldn't be checked. Try again, or cancel it.", refused: false });
  });
  it("reads a failure from before this change, or a malformed reason, as a failed check", () => {
    expect(failed({ generation: 1, code: "upload_job_failed" }).message).toMatch(/couldn't be checked/);
    expect(failed({ generation: 1, code: "upload_job_failed", reason: "<b>", what: null }).message).toMatch(/couldn't be checked/);
  });
  it("keeps its reason after a restart bumped the generation, and says nothing of a failure it has no record of", () => {
    // SLN-1466: a retry clears the note; recovery at a restart bumps the generation and keeps it
    expect(failed({ generation: 1, code: "upload_job_failed", reason: "not_an_ebook", what: null }, 2))
      .toMatchObject({ message: "Not added: not an e-book.", refused: true });
    expect(failed(undefined)).toMatchObject({ message: null });
    expect(failed(undefined).refused).toBeUndefined();
  });
});

describe("why a checked file can't be added", () => {
  const inspected = (drm: string | null, problem: string | null, inspectedFormat = true) => {
    const validation = validationFor("pdf", problem, drm, inspectedFormat);
    return { prepared: { validation, drm, problem }, publication: { medallion: { gold: validation.downloadable ? [{ key: "gold" }] : [] } } } as
      unknown as Parameters<typeof quarantineMessage>[0];
  };
  it("calls a password a password, and names the DRM", () => {
    expect(quarantineMessage(inspected("pdf-password", null))).toBe("Not added: the file is locked with a password. Upload a copy without it.");
    expect(quarantineMessage(inspected("adobe-adept", null))).toBe("Not added: the file is locked with Adobe DRM. Upload a copy without it.");
    expect(quarantineMessage(inspected("unknown", null))).toBe("Not added: the file is locked with DRM. Upload a copy without it.");
  });
  it("says what is wrong with a damaged file", () => {
    expect(quarantineMessage(inspected(null, "Damaged PDF: Invalid XRef stream"))).toBe("Not added: damaged PDF: Invalid XRef stream.");
    expect(quarantineMessage(inspected(null, "FB2 larger than 64 MB: not read"))).toBe("Not added: FB2 larger than 64 MB: not read.");
  });
  it("says when Durtal can't check the format, and nothing for a file it can add", () => {
    expect(quarantineMessage(inspected(null, null, false))).toBe("Not added: Durtal can't check files of this format yet.");
    expect(quarantineMessage(inspected(null, null))).toBeNull();
  });
});

// SLN-1467: one stored check that couldn't be read threw, and the whole batch failed to show
describe("a checked file whose stored check can't be read", () => {
  const row = coreOperationFixture;
  it("says so on its own row, offers no Preview, and does not throw", () => {
    const upload = row({ state: "ready", receipt: { version: 1, damaged: true }, receipt_status: 200, progress: { inspectionV1: { version: 1 } } });
    const view = projectUploadItem(upload);
    expect(view.state).toBe("ready");
    expect(checkedItemView(view, upload)).toMatchObject({ state: "ready", message: UNREADABLE_CHECK_MESSAGE, refused: true });
  });
  it("leaves a file that is not yet checked as it is", () => {
    for (const upload of [row({ state: "ready" }), row({ state: "receiving" }), row({ state: "failed" })]) {
      const view = projectUploadItem(upload);
      expect(checkedItemView(view, upload)).toEqual(view);
    }
  });
});
