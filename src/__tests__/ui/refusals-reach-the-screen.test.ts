import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// SLN-1033: a write the server refuses on purpose says why, wherever it is
// made from. The refusal crosses as data (actionResult), the client adapters
// raise it again as an ActionRefusal, and the catches show its reason.

const ui = vi.hoisted(() => ({ deleteEdition: vi.fn() }));
vi.mock("@/lib/actions/catalogue-ui", () => ui);

import { ActionRefusal } from "@/lib/actions/action-refusal";
import { refusalAction, refusalMessage } from "@/lib/actions/refusal";
import { actionResult } from "@/lib/actions/action-result";
import { ExpectedActionError } from "@/lib/actions/expected-error";
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

  it("carry the page a refusal names, so the toast can open the book that holds an ISBN", async () => {
    const sent = await actionResult(async () => {
      throw new ExpectedActionError("An edition with ISBN 9780140447934 already exists", { href: "/library/against-nature" });
    });
    expect(sent).toEqual({ ok: false, error: "An edition with ISBN 9780140447934 already exists", href: "/library/against-nature" });
    ui.deleteEdition.mockResolvedValueOnce(sent);
    const refused = await deleteEdition("e1").catch((error: unknown) => error);
    const open = vi.fn();
    const toast = refusalAction(refused, open);
    expect(toast?.action.label).toBe("Open that book");
    toast?.action.onClick();
    expect(open).toHaveBeenCalledWith("/library/against-nature");
    expect(refusalAction(new ActionRefusal("Undo that value first."), open)).toBeUndefined();
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

/** Each server adapter file and the client file that unwraps it */
const ADAPTERS = [
  ["lib/actions/catalogue-ui.ts", "lib/actions/catalogue-client.ts"],
  ["lib/actions/taxonomy-ui.ts", "lib/actions/taxonomy-client.ts"],
] as const;

/** Writes the client adapters offer, by the module that defines them */
function routedWrites() {
  const routed = new Map<string, Set<string>>();
  for (const [server, client] of ADAPTERS) {
    const modules = [...read(server).matchAll(/^import \* as \w+ from "\.\/([\w-]+)";/gm)].map((m) => m[1]);
    const names = [...read(client).matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
    for (const mod of modules) {
      const offered = new Set(names.filter((name) => new RegExp(`export async function ${name}\\b`).test(read(`lib/actions/${mod}.ts`))));
      routed.set(mod, new Set([...(routed.get(mod) ?? []), ...offered]));
    }
  }
  return routed;
}

/** Each non-type name a client file imports from a "@/lib/actions/<module>" */
function clientImports() {
  const found: { file: string; mod: string; name: string }[] = [];
  for (const file of clientFiles()) {
    for (const m of readFileSync(file, "utf8").matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/actions\/([\w-]+)"/g)) {
      for (const spec of m[1].split(",")) {
        const name = spec.trim().split(/\s+as\s+/)[0];
        if (name && !name.startsWith("type ")) found.push({ file: path.relative(SRC, file), mod: m[2], name });
      }
    }
  }
  return found;
}

/**
 * Called from the screen and refusing on purpose, but not routed: each says why.
 * The reading dialogs show their own "could not load" state for any failure.
 */
const UNROUTED_REFUSALS = new Set(["reading.getReadingDialogData"]);

describe("the screens", () => {
  it("make every routed write through the client adapters, never from its own module", () => {
    const routed = routedWrites();
    const direct = clientImports()
      .filter(({ mod, name }) => routed.get(mod)?.has(name))
      .map(({ file, name }) => `${file}: ${name}`);
    expect(direct).toEqual([]);
  });

  it("route every write they call that refuses on purpose, so its reason is not hidden", () => {
    const routed = routedWrites();
    const unrouted = new Set<string>();
    for (const { mod, name } of clientImports()) {
      if (routed.get(mod)?.has(name)) continue;
      let source: string;
      try {
        source = read(`lib/actions/${mod}.ts`);
      } catch {
        continue;
      }
      if (!/^\s*["']use server["']/.test(source)) continue;
      const start = source.indexOf(`export async function ${name}(`);
      if (start < 0) continue;
      // Up to the next top-level declaration
      const next = source.slice(start + 1).search(/\n(export |async function |function |const |let |type |interface |class )/);
      const body = source.slice(start, next < 0 ? undefined : start + 1 + next);
      if (body.includes("throw new ExpectedActionError(")) unrouted.add(`${mod}.${name}`);
    }
    expect([...unrouted].filter((key) => !UNROUTED_REFUSALS.has(key))).toEqual([]);
    for (const key of UNROUTED_REFUSALS) expect(unrouted, key).toContain(key);
  });

  it("refuse with ExpectedActionError in every routed module, so the reason crosses as data", () => {
    // Faults no one can fix from the screen stay plain errors, hidden and logged by Next
    const faults = [
      "Replacement cover source differs from its verified stage",
      "Unknown media owner",
      "Could not allocate a person URL",
      "The perfume note vocabulary is missing",
      "This image is not a stored Durtal asset",
    ];
    const plain: string[] = [];
    for (const mod of routedWrites().keys()) {
      for (const m of read(`lib/actions/${mod}.ts`).matchAll(/throw new Error\(\s*([^)]{0,80})/g))
        if (!faults.some((fault) => m[1].includes(fault))) plain.push(`${mod}: ${m[1].trim()}`);
    }
    expect(plain).toEqual([]);
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
