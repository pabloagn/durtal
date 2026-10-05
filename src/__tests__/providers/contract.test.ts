import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ExternalFetchError } from "@/lib/api/external-fetch";
import { WORK_KINDS } from "@/lib/catalogue/kinds";
import { adapterProblems, ProviderError, type ProviderAdapter } from "@/lib/providers/contract";
import { fetchProviderDetail, reviewProposal, searchProvider } from "@/lib/providers/run";
import { providersFor } from "@/lib/providers/registry";

function adapter(overrides: Partial<ProviderAdapter<"painting">> = {}): ProviderAdapter<"painting"> {
  return {
    id: `example-museum-${Math.random().toString(36).slice(2, 8)}`,
    label: "Example museum",
    domain: "painting",
    levels: ["work", "art_object"],
    fields: { work: ["title"], art_object: ["accessionNumber", "heightCm"] },
    documentation: "https://example.org/open-access",
    needsKey: false,
    limits: { timeoutMs: 200, minIntervalMs: 0, maxResults: 2 },
    search: async () => [],
    detail: async (externalId) => ({ externalId, url: null, attribution: "Example museum", payload: { title: "Night" } }),
    normalize: () => [{ level: "work", fields: { title: "Night" } }],
    ...overrides,
  };
}

describe("the provider contract", () => {
  it("checks a declaration: its collection's levels, its fields, its terms and limits", () => {
    expect(adapterProblems(adapter())).toEqual([]);
    const bad = adapter({
      id: "Example Museum",
      levels: ["work", "edition" as never],
      fields: { release: ["title"] } as never,
      documentation: "http://example.org",
      limits: { timeoutMs: 0, minIntervalMs: -1, maxResults: 1000 },
    });
    expect(adapterProblems(bad)).toEqual([
      "Example Museum: the id must be a lowercase provider name",
      "Example Museum: edition is not a level of painting",
      "Example Museum: fields for release, which it does not describe",
      "Example Museum: the documentation must be an https link",
      "Example Museum: the time limit must be between 1 ms and 30 s",
      "Example Museum: the gap between calls cannot be negative",
      "Example Museum: it must keep between 1 and 100 results",
    ]);
  });

  it("keeps the provider's number of results and drops results it cannot read", async () => {
    const hits = await searchProvider(
      adapter({
        search: async () => [
          { externalId: "1", title: "Night" },
          { externalId: "", title: "No id" },
          { externalId: "2", title: "Day", url: "https://example.org/2" },
          { externalId: "3", title: "Dusk" },
        ],
      }),
      { text: "night", level: "work" },
    );
    expect(hits).toEqual([
      { externalId: "1", title: "Night", detail: null, url: null },
      { externalId: "2", title: "Day", detail: null, url: "https://example.org/2" },
    ]);
  });

  it("answers within the time limit, keeps the gap between calls, and names a refusal", async () => {
    const slow = adapter({ search: () => new Promise(() => {}) });
    await expect(searchProvider(slow, { text: "x", level: "work" })).rejects.toMatchObject({ reason: "timeout" });

    const starts: number[] = [];
    const spaced = adapter({
      limits: { timeoutMs: 1000, minIntervalMs: 60, maxResults: 5 },
      search: async () => {
        starts.push(Date.now());
        return [];
      },
    });
    await Promise.all([searchProvider(spaced, { text: "a", level: "work" }), searchProvider(spaced, { text: "b", level: "work" })]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(55);

    const busy = adapter({
      search: async () => {
        throw new ExternalFetchError("example.org answered 429", 429);
      },
    });
    await expect(searchProvider(busy, { text: "x", level: "work" })).rejects.toMatchObject({ reason: "rate_limited" });
    await expect(searchProvider(adapter(), { text: "x", level: "version" as never })).rejects.toMatchObject({ reason: "unsupported" });
    await expect(searchProvider(adapter(), { text: "  ", level: "work" })).rejects.toThrow(ProviderError);
  });

  it("accepts only proposals for its own levels and fields", async () => {
    const found = await fetchProviderDetail(adapter(), "1");
    expect(found.proposals).toEqual([{ level: "work", fields: { title: "Night" } }]);
    await expect(
      fetchProviderDetail(adapter({ normalize: () => [{ level: "work", fields: { title: "Night", location: "Gallery 3" } }] }), "1"),
    ).rejects.toThrow("Example museum proposed fields it does not declare: location");
    await expect(
      fetchProviderDetail(adapter({ normalize: () => [{ level: "release" as never, fields: {} }] }), "1"),
    ).rejects.toMatchObject({ reason: "unsupported" });
    await expect(
      fetchProviderDetail(adapter({ detail: async () => ({ externalId: "2", url: null, attribution: "x", payload: {} }) }), "1"),
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("fills only empty fields; a value here or a lock is a conflict for the person", () => {
    const proposal = { level: "art_object", fields: { accessionNumber: "SK-C-5", heightCm: 363 } };
    expect(reviewProposal({ accessionNumber: null, heightCm: 360 }, proposal, { record: false, fields: [] })).toEqual({
      changes: { accessionNumber: "SK-C-5" },
      conflicts: [{ field: "heightCm", current: 360, incoming: 363, reason: "different" }],
    });
    expect(reviewProposal({ accessionNumber: null, heightCm: null }, proposal, { record: false, fields: ["heightCm"] })).toEqual({
      changes: { accessionNumber: "SK-C-5" },
      conflicts: [{ field: "heightCm", current: null, incoming: 363, reason: "locked" }],
    });
    expect(reviewProposal({ accessionNumber: null, heightCm: null }, proposal, { record: true, fields: [] }).changes).toEqual({});
  });
});

describe("manual entry needs no provider", () => {
  it("lists providers per collection, and none is required", () => {
    for (const kind of WORK_KINDS) expect(Array.isArray(providersFor(kind))).toBe(true);
  });

  it("keeps catalogue writes, imports and exports free of provider calls", () => {
    // Source lookups call providers; nothing else that saves a record does
    const lookups = new Set(["src/lib/actions/perfume-sources.ts"]);
    const folders = ["src/lib/actions", "src/lib/catalogue", "src/lib/interchange"];
    for (const folder of folders)
      for (const file of readdirSync(folder).filter((f) => f.endsWith(".ts"))) {
        const path = join(folder, file);
        if (lookups.has(path)) continue;
        const source = readFileSync(path, "utf8");
        expect(source.includes("@/lib/providers"), path).toBe(false);
        for (const lookup of lookups) expect(source.includes(lookup.replace(/^src\/|\.ts$/g, "").replace("lib/", "@/lib/")), path).toBe(false);
      }
  });
});
