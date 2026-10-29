import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ sql: vi.fn(), people: vi.fn(), films: vi.fn(), paintings: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute: store.sql, query: { authors: { findMany: store.people } } } }));
vi.mock("@/lib/catalogue/film-store", () => ({ loadFilmCards: store.films }));
vi.mock("@/lib/catalogue/painting-store", () => ({ loadPaintingCards: store.paintings }));
vi.mock("@/lib/catalogue/perfume-store", () => ({ loadPerfumeCards: vi.fn() }));
vi.mock("@/lib/actions/publishers", () => ({ getAcquisitionTargetsForExport: vi.fn() }));
vi.mock("@/lib/ebooks/work-availability", () => ({ getWorkDigitalAvailability: vi.fn() }));
import { collectionExportRows } from "@/lib/export/collections";
import { fetchAuthorsForExport } from "@/lib/export/catalogue";

beforeEach(() => { vi.clearAllMocks(); store.sql.mockResolvedValue([]); });
const base = { id: "a", title: "Missing values", rating: null, isFavourite: false };
async function collection(entity: "films" | "paintings", native: boolean) {
  store.sql.mockResolvedValueOnce([{ id: "a" }]);
  return (await collectionExportRows(entity, null, native))[0];
}

describe("native projections preserve absence and legacy values", () => {
  it("keeps an absent film runtime null only in native output", async () => {
    store.films.mockResolvedValue([{ ...base, originalTitle: null, runtimeSeconds: null, releaseDate: null, directors: [], countries: [], holdings: { physical: 0, digital: 0 } }]);
    expect(await collection("films", false)).toMatchObject({ runtime: "" });
    expect(await collection("films", true)).toMatchObject({ runtime: null, runtime_seconds: null });
  });

  it("keeps missing painting object fields null without erasing a stored empty label", async () => {
    const card = { ...base, creationDate: null, painters: [], primaryObject: null, personalCount: 0 };
    store.paintings.mockResolvedValue([card]);
    expect(await collection("paintings", false)).toMatchObject({ original: "", original_owner: "" });
    expect(await collection("paintings", true)).toMatchObject({ original: null, original_owner: null });
    store.paintings.mockResolvedValue([{ ...card, primaryObject: { kind: "original", label: "", ownership: "unknown", owner: "", heightCm: null, widthCm: null } }]);
    expect(await collection("paintings", true)).toMatchObject({ original: "" });
  });

  it("retains accepted incomplete life-date components and flags without inventing a structured date", async () => {
    store.people.mockResolvedValue([{
      id: "a", name: "Legacy person", sortName: null, firstName: null, lastName: null, realName: null, country: null, gender: null,
      birthYear: 1900, birthMonth: null, birthDay: 12, birthYearIsApproximate: true, birthYearGregorian: 1901,
      deathYear: 2000, deathMonth: 2, deathDay: 29, deathYearIsApproximate: false, deathYearGregorian: 2000,
      bio: null, website: null, workAuthors: [],
    }]);
    expect((await fetchAuthorsForExport(null))[0]).toMatchObject({ birth_year: 1900, birth_month: null, birth_day: 12 });
    expect((await fetchAuthorsForExport(null, true))[0]).toMatchObject({
      birth_year: 1900, birth_month: null, birth_day: 12, birth_date: null, birth_year_is_approximate: true, birth_year_gregorian: 1901,
      death_date: { precision: "day", start: { year: 2000, month: 2, day: 29 }, approximate: false }, death_year_is_approximate: false,
    });
  });
});
