import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish pass 4, item 1 (SLN-829): in list view on a phone, Places cut
// every name ("Seed Museum…") and Films, Perfumes and Paintings cut the line
// that says who made each one ("Seed Person 120 · 1921 · 1h …").

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("film, perfume and painting rows", () => {
  const row = source("components/shared/work-row.tsx");

  it("cut nothing: the title wraps and the facts wrap between facts", () => {
    expect(row).not.toMatch(/\btruncate\b/);
    expect(row).toContain('<p className="type-item-title [overflow-wrap:anywhere]">{title}</p>');
    expect(row).toContain("<FactsRow facts=");
  });

  it("keep the star on the title's first line", () => {
    expect(row).toContain('<CapAlignedControls height={32} coarseHeight={44} className="type-item-title">');
  });

  it("are one row for all three kinds", () => {
    for (const file of ["components/films/film-card.tsx", "components/perfumes/perfume-card.tsx", "components/paintings/painting-card.tsx"]) {
      const card = source(file);
      expect(card).toContain("<WorkRow");
      expect(card.slice(card.indexOf("Row({"))).not.toMatch(/\btruncate\b/);
    }
  });
});

describe("a place's row", () => {
  const row = source("components/venues/venue-list-item.tsx");

  it("cuts neither the name nor the address", () => {
    expect(row).not.toMatch(/\btruncate\b/);
    expect(row).toContain('<h3 className="type-item-title [overflow-wrap:anywhere] group-hover:text-accent-primary">');
  });

  it("puts the kind and rating under the name below 640px", () => {
    expect(row).toContain('<div className="mt-1.5 flex flex-wrap items-center gap-3 sm:hidden">{meta}</div>');
    expect(row).toContain("hidden flex-shrink-0 items-center gap-3 sm:flex");
  });

  it("gives the website link a tooltip", () => {
    expect(row).toContain('data-tooltip="Website"');
  });
});
