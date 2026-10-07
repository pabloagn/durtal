import { describe, expect, it } from "vitest";
import {
  emptyTaxonomy,
  fromSearchResult,
  newEditionDraft,
  newWorkDraft,
  wizardBookInput,
  workInput,
} from "@/app/library/new/wizard-model";
import { EMPTY_INSTANCE } from "@/components/books/instance-form";
import type { SearchResult } from "@/lib/api/types";
import { wizardBookSchema } from "@/lib/validations/wizard";

// The add-book wizard's drafts and the book it saves (SLN-513 split the
// wizard into steps; these are the values the steps share)

const settings = { newBookLanguage: "fr", newBookStatus: "wanted" as const };
const noSource = { source: "", sourceId: "" };
const LOCATION = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "22222222-2222-4222-8222-222222222222";
const GENRE = "33333333-3333-4333-8333-333333333333";
const COLLECTION = "44444444-4444-4444-8444-444444444444";
const WORK = "55555555-5555-4555-8555-555555555555";

describe("wizard drafts", () => {
  it("start in the language and status from Settings", () => {
    expect(newWorkDraft(settings)).toMatchObject({
      originalLanguage: "fr",
      catalogueStatus: "wanted",
      acquisitionPriority: "none",
      recommenderIds: [],
    });
    expect(newEditionDraft(settings, null)).toMatchObject({ isbn13: "", language: "fr" });
  });

  it("take an ISBN from the link, an ISBN-10 as its ISBN-13", () => {
    expect(newEditionDraft(settings, "9780141187761").isbn13).toBe("9780141187761");
    expect(newEditionDraft(settings, "014118776X").isbn13).toBe("9780141187761");
  });

  it("fill the work and the edition from a search result", () => {
    const result: SearchResult = {
      source: "open_library",
      sourceId: "OL1W",
      title: "Kaputt",
      authors: ["Curzio Malaparte", "Someone Else"],
      publicationYear: 1944,
      description: "<p>War <b>diary</b></p>",
      isbn13: "9781590171479",
      publisher: "NYRB",
      pageCount: 432,
      categories: [],
      language: "ita",
    };
    const { work, edition, source } = fromSearchResult(result, "en");
    expect(work).toEqual({
      title: "Kaputt",
      authorName: "Curzio Malaparte",
      originalYear: "1944",
      originalLanguage: "it",
      description: "War diary",
      // The series, status, priority and recommenders are not touched
    });
    expect(edition).toEqual({
      isbn13: "9781590171479",
      publisher: "NYRB",
      publicationYear: "1944",
      language: "it",
      pageCount: "432",
      binding: "",
      coverUrl: "",
    });
    expect(source).toEqual({ source: "open_library", sourceId: "OL1W" });
  });
});

describe("the book the wizard saves", () => {
  const work = {
    ...newWorkDraft(settings),
    title: "  The Rings of Saturn ",
    authorName: " W. G. Sebald ",
    originalYear: "1995",
    seriesName: "",
  };
  const edition = { ...newEditionDraft(settings, null), isbn13: "978-0-8112-1413-2", pageCount: "296" };

  it("sends the work's values trimmed, with empty fields left out", () => {
    expect(workInput(work, { source: "isbndb", sourceId: "x1" })).toEqual({
      title: "The Rings of Saturn",
      originalLanguage: "fr",
      originalYear: 1995,
      description: undefined,
      seriesName: undefined,
      seriesPosition: undefined,
      catalogueStatus: "wanted",
      acquisitionPriority: "none",
      recommenderIds: undefined,
      metadataSource: "isbndb",
      metadataSourceId: "x1",
    });
  });

  it("is one valid write: new work, taxonomy, edition, located copies and collections", () => {
    const taxonomy = { ...emptyTaxonomy(), subjects: [SUBJECT], genres: [GENRE], collections: [COLLECTION] };
    const input = wizardBookInput({
      work,
      edition,
      source: noSource,
      existingWorkId: null,
      taxonomy,
      copies: [{ ...EMPTY_INSTANCE, locationId: LOCATION, format: "hardcover", fileSizeBytes: "" }],
    });
    expect(input.authorName).toBe("W. G. Sebald");
    expect(input.taxonomy?.subjectIds).toEqual([SUBJECT]);
    expect(input.edition).toMatchObject({ isbn13: "9780811214132", pageCount: 296, genreIds: [GENRE], tagIds: undefined });
    expect(input.copies).toEqual([expect.objectContaining({ locationId: LOCATION, format: "hardcover", fileSizeBytes: undefined })]);
    expect(input.collectionIds).toEqual([COLLECTION]);
    expect(wizardBookSchema.safeParse(input).success).toBe(true);
  });

  it("adds only the edition to an existing work", () => {
    const input = wizardBookInput({
      work,
      edition,
      source: noSource,
      existingWorkId: WORK,
      taxonomy: emptyTaxonomy(),
      copies: [],
    });
    expect(input).toMatchObject({ existingWorkId: WORK, work: undefined, taxonomy: undefined, copies: [] });
    expect(wizardBookSchema.safeParse(input).success).toBe(true);
  });
});
