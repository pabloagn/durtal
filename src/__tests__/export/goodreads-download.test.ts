import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/notifications/toast", () => ({ toast: { pending: vi.fn() } }));
import { goodreadsWarning, triggerExport } from "@/components/shared/export-menu";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("returns the authoritative unresolved count with a usable download, without needing preflight", async () => {
  const click = vi.fn();
  const anchor = { href: "", download: "", click };
  vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn(), removeChild: vi.fn() } });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Book Id,Title\n,Example", {
    headers: { "Content-Disposition": 'attachment; filename="goodreads.csv"', "X-Durtal-Goodreads-Unresolved": "2" },
  })));
  expect(await triggerExport("goodreads", "all", "csv")).toEqual({ unresolvedIds: 2 });
  expect(click).toHaveBeenCalledOnce();
  expect(anchor.download).toBe("goodreads.csv");
  expect(goodreadsWarning(2)).toContain("2 unresolved Goodreads IDs left blank");
});
