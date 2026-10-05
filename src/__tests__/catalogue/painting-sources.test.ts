import { describe, expect, it } from "vitest";
import { compareSizes, convertSize, PAINTING_SOURCES, sizeText, sourceChanges } from "@/lib/catalogue/painting-sources";
import { adapterProblems, type ProviderAdapter } from "@/lib/providers/contract";
import { providersFor } from "@/lib/providers/registry";
import { articArtwork, articArtworks, metArtwork, metArtworks, museumDate, museumProposals } from "@/lib/providers/museums";

describe("museum sources", () => {
  it("looks up only open collection APIs without a key", () => {
    expect(PAINTING_SOURCES.filter((s) => s.access === "lookup").map((s) => s.name)).toEqual(["Art Institute of Chicago", "The Met"]);
    expect(providersFor("painting").map((p) => p.id)).toEqual(["artic", "metmuseum"]);
    for (const adapter of [articArtworks, metArtworks]) {
      expect(adapterProblems(adapter as unknown as ProviderAdapter)).toEqual([]);
      expect(adapter.needsKey).toBe(false);
    }
  });

  it("reads the Art Institute's answer: centimetres, reference number, on view, credited image", () => {
    const artwork = articArtwork(
      {
        id: 27992,
        title: "A Sunday on La Grande Jatte — 1884",
        artist_display: "Georges Seurat\nFrench, 1859–1891",
        artist_title: "Georges Seurat",
        date_display: "1884–86",
        date_start: 1884,
        date_end: 1886,
        medium_display: "Oil on canvas",
        dimensions: "207.5 × 308.1 cm (81 3/4 × 121 1/4 in.)",
        dimensions_detail: [{ depth: null, width: 308.1, height: 207.5, diameter: null, clarification: null }],
        main_reference_number: "1926.224",
        credit_line: "Helen Birch Bartlett Memorial Collection",
        is_on_view: true,
        gallery_title: "Gallery 240",
        image_id: "2d484387-2509-5e8e-2c43-22f9981972eb",
        is_public_domain: true,
      },
      "https://www.artic.edu/iiif/2",
    );
    expect(artwork).toMatchObject({
      institution: { name: "Art Institute of Chicago", wikidataId: "Q239303" },
      id: "27992",
      artist: "Georges Seurat",
      date: { start: 1884, end: 1886 },
      dimensions: { heightCm: 207.5, widthCm: 308.1, depthCm: null },
      accessionNumber: "1926.224",
      onView: true,
      gallery: "Gallery 240",
      image: { url: "https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/843,/0/default.jpg", credit: "Art Institute of Chicago", license: "CC0 1.0" },
    });
    // A work under copyright gets no image
    expect(articArtwork({ id: 1, image_id: "x", is_public_domain: false }, "https://www.artic.edu/iiif/2").image).toBeNull();
    // A museum that does not say whether it shows the work: unknown, not "not on view"
    expect(articArtwork({ id: 1 }, null).onView).toBeNull();
  });

  it("reads the Met's answer: an empty gallery means not on view", () => {
    const shown = metArtwork({
      objectID: 437853,
      title: "Wheat Field with Cypresses",
      artistDisplayName: "Vincent van Gogh",
      objectBeginDate: 1889,
      objectEndDate: 1889,
      medium: "Oil on canvas",
      measurements: [{ elementName: "Overall", elementMeasurements: { Height: 73.2, Width: 93.4 } }],
      accessionNumber: "1993.132",
      GalleryNumber: "822",
      primaryImage: "https://images.metmuseum.org/x.jpg",
      isPublicDomain: true,
    });
    expect(shown).toMatchObject({ onView: true, gallery: "Gallery 822", dimensions: { heightCm: 73.2, widthCm: 93.4 }, accessionNumber: "1993.132" });
    expect(metArtwork({ objectID: 1, GalleryNumber: "" }).onView).toBe(false);
  });

  it("proposes the work and the object apart, and never a location", () => {
    const proposals = museumProposals({
      externalId: "1",
      url: null,
      attribution: "x",
      license: null,
      payload: metArtwork({
        objectID: 1,
        title: "Portrait",
        artistDisplayName: "Rembrandt van Rijn",
        objectBeginDate: 1660,
        objectEndDate: 1669,
        measurements: [{ elementName: "Overall", elementMeasurements: { Height: 80, Width: 67.3 } }],
        accessionNumber: "14.40.618",
        GalleryNumber: "964",
      }) as never,
    });
    expect(proposals).toEqual([
      {
        level: "work",
        fields: {
          title: "Portrait",
          creationDate: { precision: "range", start: { year: 1660 }, end: { year: 1669 } },
          painter: { name: "Rembrandt van Rijn", attribution: "Rembrandt van Rijn" },
        },
      },
      {
        level: "art_object",
        fields: {
          owner: { name: "The Metropolitan Museum of Art", wikidataId: "Q160236", providerId: "1" },
          accessionNumber: "14.40.618",
          dimensions: { height: 80, width: 67.3, depth: null, unit: "cm" },
          display: { onView: true, gallery: "Gallery 964" },
        },
      },
    ]);
    expect(museumDate(1500, 1500)).toEqual({ precision: "year", start: { year: 1500 } });
    expect(museumDate(1510, 1500)).toBeNull();
    expect(museumDate(null, 1500)).toBeNull();
  });

  it("compares sizes across units within half a centimetre", () => {
    const inches = { height: 28.875, width: 36.75, depth: null, unit: "in" as const };
    const museum = { height: 73.3, width: 93.3, depth: null, unit: "cm" as const };
    expect(compareSizes(inches, museum)).toBe("same");
    expect(compareSizes({ height: 50, width: 40, depth: null, unit: "cm" }, museum)).toBe("conflict");
    expect(compareSizes({ height: null, width: null, depth: null, unit: null }, museum)).toBe("fill");
    expect(sizeText(convertSize(museum, "in"))).toBe("28.858 × 36.732 in");
    expect(sizeText(inches)).toBe("28.875 × 36.75 in");
  });

  it("names what changed between two answers", () => {
    const show = (_: string, v: unknown) => (v === null ? null : String((v as { name?: string }).name ?? v));
    expect(
      sourceChanges({ painter: { name: "Rembrandt van Rijn" }, accessionNumber: "14.40.618" }, { painter: { name: "Workshop of Rembrandt" }, accessionNumber: "14.40.618" }, show),
    ).toEqual([{ field: "painter", before: "Rembrandt van Rijn", after: "Workshop of Rembrandt" }]);
  });
});
