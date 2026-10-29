import { beforeEach, describe, expect, it, vi } from "vitest";
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/notifications/toast", () => ({ toast: notices }));
import { undoToast } from "@/components/reading/reading-client";
beforeEach(() => vi.clearAllMocks());
const undo = () => notices.success.mock.calls[0][1].action.onClick();
describe("Undo feedback", () => {
  it("announces only after the restore resolves", async () => {
    let resolve: () => void = () => {};
    undoToast("Removed", () => new Promise<void>(done => { resolve = done; }), "Back in Up next");
    const pending = undo(); expect(notices.success).toHaveBeenCalledTimes(1);
    resolve(); await pending; expect(notices.success).toHaveBeenLastCalledWith("Back in Up next");
  });
  it("keeps a handled refusal from claiming success", async () => {
    undoToast("Removed", () => false, "Back in Up next"); await undo();
    expect(notices.success).toHaveBeenCalledTimes(1);
  });
  it("reports a thrown refusal without a success announcement", async () => {
    undoToast("Removed", () => { throw new Error("stale"); }); await undo();
    expect(notices.success).toHaveBeenCalledTimes(1); expect(notices.error).toHaveBeenCalledOnce();
  });
});
