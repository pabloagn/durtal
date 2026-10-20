import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_WORK_SLUGS } from "@/lib/catalogue/slugs";

/* A work's slug never names a fixed page beside its own (SLN-1287) */

describe("reserved work slugs", () => {
  it("name every fixed page under /library, /films, /perfumes and /paintings", () => {
    const fixed = new Set<string>();
    for (const home of ["library", "films", "perfumes", "paintings"]) {
      const dir = path.join(process.cwd(), "src/app/(catalogue)", home);
      for (const entry of readdirSync(dir, { withFileTypes: true }))
        // Route groups "(list)" and the "[slug]" page take no address segment
        if (entry.isDirectory() && !/^[([]/.test(entry.name)) fixed.add(entry.name);
    }
    expect([...RESERVED_WORK_SLUGS].sort()).toEqual([...fixed].sort());
  });
});
