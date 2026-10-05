import { describe, expect, it } from "vitest";
import { PERFUME_SOURCES, readPerfumeLink, splitConcentration } from "@/lib/catalogue/perfume-sources";
import { adapterProblems, type ProviderAdapter } from "@/lib/providers/contract";
import { providersFor } from "@/lib/providers/registry";
import { wikidataDate, wikidataPerfumes } from "@/lib/providers/wikidata-perfumes";

describe("perfume sources", () => {
  it("looks up only a source with a documented API; the others are cited", () => {
    expect(PERFUME_SOURCES.filter((s) => s.access === "lookup").map((s) => s.name)).toEqual(["Wikidata"]);
    expect(PERFUME_SOURCES.filter((s) => s.access === "cite").map((s) => s.name)).toEqual(["Fragrantica", "Basenotes", "Parfumo"]);
    expect(providersFor("perfume").map((p) => p.id)).toEqual(["wikidata"]);
    expect(adapterProblems(wikidataPerfumes as unknown as ProviderAdapter)).toEqual([]);
    // Nothing is proposed for notes or formulations: Wikidata has none
    expect(wikidataPerfumes.fields.work).not.toContain("notes");
  });

  it("reads a link by its address alone", () => {
    expect(readPerfumeLink("https://www.fragrantica.com/perfume/Chanel/Chanel-No-5-Parfum-28711.html")).toMatchObject({
      host: "fragrantica.com",
      source: { name: "Fragrantica", access: "cite" },
      externalId: "28711",
      hints: { title: "Chanel No 5", house: "Chanel", concentration: "parfum" },
    });
    expect(readPerfumeLink("https://basenotes.com/fragrances/shalimar-eau-de-parfum-by-guerlain.26131010")).toMatchObject({
      source: { name: "Basenotes" },
      externalId: "26131010",
      hints: { title: "Shalimar", house: "Guerlain", concentration: "eau_de_parfum" },
    });
    expect(readPerfumeLink("https://www.parfumo.com/Perfumes/Serge_Lutens/ambre-sultan")).toMatchObject({
      source: { name: "Parfumo" },
      hints: { title: "Ambre Sultan", house: "Serge Lutens", concentration: null },
    });
    expect(readPerfumeLink("https://www.wikidata.org/wiki/Q820507")).toMatchObject({
      source: { name: "Wikidata", access: "lookup" },
      externalId: "Q820507",
    });
    // A house's own page is kept as a link; its address says nothing Durtal reads
    expect(readPerfumeLink("https://www.guerlain.com/fr/fr-fr/p/shalimar")).toMatchObject({
      host: "guerlain.com",
      source: null,
      externalId: null,
      hints: { title: null, house: null, concentration: null },
    });
    expect(readPerfumeLink("not a link")).toBeNull();
    expect(readPerfumeLink("ftp://example.org/x")).toBeNull();
    expect(readPerfumeLink("https://user:secret@example.org/x")).toBeNull();
  });

  it("reads a concentration from the last words of a name only", () => {
    expect(splitConcentration("Shalimar Eau de Parfum")).toEqual({ title: "Shalimar", concentration: "eau_de_parfum" });
    expect(splitConcentration("Terre d'Hermès EDT")).toEqual({ title: "Terre d'Hermès", concentration: "eau_de_toilette" });
    expect(splitConcentration("Black Opium Extrait de Parfum")).toEqual({ title: "Black Opium", concentration: "extrait" });
    // "Parfum" alone, or inside a name, is the name
    expect(splitConcentration("Parfum")).toEqual({ title: "Parfum", concentration: null });
    expect(splitConcentration("Parfum de Thérèse")).toEqual({ title: "Parfum de Thérèse", concentration: null });
  });

  it("turns Wikidata times into catalogue dates without inventing precision", () => {
    expect(wikidataDate({ time: "+1921-05-05T00:00:00Z", precision: 11 })).toEqual({ precision: "day", start: { year: 1921, month: 5, day: 5 } });
    expect(wikidataDate({ time: "+1921-05-00T00:00:00Z", precision: 10 })).toEqual({ precision: "month", start: { year: 1921, month: 5 } });
    expect(wikidataDate({ time: "+1921-00-00T00:00:00Z", precision: 9 })).toEqual({ precision: "year", start: { year: 1921 } });
    expect(wikidataDate({ time: "+1925-00-00T00:00:00Z", precision: 8 })).toEqual({ precision: "range", start: { year: 1920 }, end: { year: 1929 } });
    expect(wikidataDate({ time: "+1901-00-00T00:00:00Z", precision: 7 })).toBeNull();
    expect(wikidataDate(null)).toBeNull();
  });

  it("proposes only what the item says", () => {
    const proposals = wikidataPerfumes.normalize({
      externalId: "Q820507",
      url: "https://www.wikidata.org/wiki/Q820507",
      attribution: "Wikidata",
      license: "CC0 1.0",
      payload: {
        id: "Q820507",
        label: "Chanel No. 5",
        description: null,
        brands: [{ id: "Q180270", label: "Chanel" }],
        manufacturers: [],
        perfumers: [{ id: "Q1374026", label: "Ernest Beaux" }],
        launched: { time: "+1921-00-00T00:00:00Z", precision: 9 },
      },
    });
    expect(proposals).toEqual([
      {
        level: "work",
        fields: {
          title: "Chanel No. 5",
          launched: { precision: "year", start: { year: 1921 } },
          organizations: [{ wikidataId: "Q180270", name: "Chanel", role: "brand" }],
          perfumers: [{ wikidataId: "Q1374026", name: "Ernest Beaux" }],
        },
      },
    ]);
  });
});
