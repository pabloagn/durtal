import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// SLN-1033: a write the server refuses on purpose says why, wherever it is
// made from. The refusal crosses as data (actionResult), the client adapters
// raise it again as an ActionRefusal, and the catches show its reason.

const ui = vi.hoisted(() => ({ deleteEdition: vi.fn() }));
vi.mock("@/lib/actions/catalogue-ui", () => ui);

import { ActionRefusal, refusalMessage } from "@/lib/actions/refusal";
import { CONNECTION_SAVE_ERROR } from "@/lib/notifications/connection";
import { deleteEdition } from "@/lib/actions/catalogue-client";

const SRC = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

describe("a refusal's message", () => {
  it("is the server's own reason for a refusal", () => {
    expect(refusalMessage(new ActionRefusal("Undo that value first."), "Could not delete the edition")).toBe(
      "Undo that value first.",
    );
  });

  it("says the connection failed when Durtal could not be reached, in every browser's words", () => {
    for (const words of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"])
      expect(refusalMessage(new TypeError(words), "Could not save")).toBe(CONNECTION_SAVE_ERROR);
  });

  it("is the caller's own words for any other failure, never Next's or the engine's", () => {
    const hidden = new Error(
      "An error occurred in the Server Components render. The specific message is omitted in production builds",
    );
    expect(refusalMessage(hidden, "Could not delete the edition")).toBe("Could not delete the edition");
    expect(refusalMessage("thrown text", "Could not save")).toBe("Could not save");
  });
});

describe("the client adapters", () => {
  it("raise a refusal sent as data as an ActionRefusal with its reason", async () => {
    ui.deleteEdition.mockResolvedValueOnce({ ok: false, error: "Undo that value first." });
    const refused = await deleteEdition("e1").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ActionRefusal);
    expect((refused as Error).message).toBe("Undo that value first.");
  });

  it("hand back the value of a write that went through", async () => {
    ui.deleteEdition.mockResolvedValueOnce({ ok: true, value: { id: "e1" } });
    expect(await deleteEdition("e1")).toEqual({ id: "e1" });
  });

  it("wrap every write they offer in actionResult on the server", () => {
    const server = read("lib/actions/catalogue-ui.ts");
    const writes = [...server.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
    expect(writes.length).toBeGreaterThan(130);
    for (const name of writes)
      expect(server, name).toMatch(new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{\\s*return actionResult\\(`));
  });
});

/** "use client" files under src, but not tests */
function clientFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : clientFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return /^\s*["']use client["']/.test(readFileSync(full, "utf8")) ? [full] : [];
  });
}

describe("the screens", () => {
  it("make every routed write through the client adapters, never from its own module", () => {
    const server = read("lib/actions/catalogue-ui.ts");
    const modules = [...server.matchAll(/^import \* as \w+ from "\.\/([\w-]+)";/gm)].map((m) => m[1]);
    const routed = new Set([...read("lib/actions/catalogue-client.ts").matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]));
    const direct: string[] = [];
    for (const file of clientFiles()) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/actions\/([\w-]+)"/g)) {
        if (!modules.includes(m[2])) continue;
        for (const spec of m[1].split(",")) {
          const name = spec.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
          if (name && routed.has(name) && !spec.trim().startsWith("type ")) direct.push(`${path.relative(SRC, file)}: ${name}`);
        }
      }
    }
    expect(direct).toEqual([]);
  });

  it("show the reason when an edition cannot be deleted, instead of nothing", () => {
    const menu = read("app/(catalogue)/library/[slug]/edition-actions-menu.tsx");
    const handler = menu.slice(menu.indexOf("async function handleDelete()"), menu.indexOf('toast.success("Edition deleted")'));
    expect(handler).toContain("await deleteEdition(editionId);");
    expect(handler).toContain('toast.error(refusalMessage(error, "Could not delete the edition"));');
    expect(menu).toContain('import { deleteEdition } from "@/lib/actions/catalogue-client";');
  });

  it("say how far a bulk change got and why it stopped", () => {
    expect(read("components/shared/selection-toolbar.tsx")).toContain(
      '${many}. ${refusalMessage(error, "The rest were not deleted.")}',
    );
    expect(read("components/books/bulk-action-toolbar.tsx")).toContain(
      '. ${refusalMessage(error, "The rest were not changed.")}',
    );
  });
});
