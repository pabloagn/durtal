import { normalizeLanguage } from "@/lib/utils/language";
import { formatRank } from "../formats";
import { identifierKeys, titleKeys } from "./keys";
import type { MatchCatalogue, IndexedWork } from "./catalogue";
import type {
  EditionRule,
  LinkEffect,
  MatchEbook,
  MatchFile,
  NewEditionEffect,
  Reason,
} from "./types";

export function usableFile(file: MatchFile): boolean {
  return (
    (file.status === "stored" || file.status === "verified") &&
    !file.drm &&
    file.availability !== "blocked"
  );
}
export function preferredMatchFile(ebook: MatchEbook): MatchFile | null {
  const preferred = ebook.files.find(
    (file) => file.id === ebook.preferredFileId && usableFile(file),
  );
  if (preferred) return preferred;
  return (
    [...ebook.files]
      .filter(usableFile)
      .sort(
        (a, b) =>
          Number(b.availability === "native") -
            Number(a.availability === "native") ||
          formatRank(a.format) - formatRank(b.format) ||
          a.id.localeCompare(b.id),
      )[0] ?? null
  );
}
/** A reviewable effect only: existing edition metadata is never rewritten here. */
export function editionEffect(
  ebook: MatchEbook,
  work: IndexedWork,
  catalogue: MatchCatalogue,
): LinkEffect {
  const { source } = work;
  const language = normalizeLanguage(ebook.language);
  const file = preferredMatchFile(ebook);
  const ids = identifierKeys(ebook.isbns, ebook.identifiers);
  const identified = source.editions.filter((edition) => {
    const keys = work.editionIdentifiers.get(edition.id)!;
    return (
      keys.isbns.some(
        (isbn) => ids.isbns.includes(isbn) && !catalogue.sharedIsbns.has(isbn),
      ) || keys.external.some((id) => ids.external.includes(id))
    );
  });
  const free = source.copies.filter(
    (copy) =>
      copy.locationId === catalogue.source.ebookLocationId &&
      copy.status !== "deaccessioned" &&
      !copy.linkedEbookId,
  );
  const editions = new Map(
    source.editions.map((edition) => [edition.id, edition]),
  );
  const missing: string[] = [];
  const ambiguities: Reason[] = [];
  if (!file) missing.push("verified_file");
  if (!catalogue.source.ebookLocationId) missing.push("ebook_location");
  let rule: EditionRule = "new_edition";
  let editionId: string | null = null;
  let instanceId: string | null = null;
  let movedFromEditionId: string | null = null;
  let isbn13: string | null = null;
  if (identified.length) {
    rule = "isbn_edition";
    if (identified.length !== 1)
      ambiguities.push({
        code: "multiple_editions",
        text: "The identifiers name more than one edition; choose an edition",
      });
    else {
      editionId = identified[0].id;
      if (language && normalizeLanguage(identified[0].language) !== language)
        ambiguities.push({
          code: "edition_language",
          text: "The identified edition has another language; confirm its identity",
        });
      const placeholderCopies = free.filter(
        (copy) =>
          editions.get(copy.editionId)!.metadataSource === "phantom_canon",
      );
      if (free.length === 1 && placeholderCopies.length === 1) {
        instanceId = free[0].id;
        movedFromEditionId = free[0].editionId;
      } else if (free.length > 1)
        ambiguities.push({
          code: "multiple_copies",
          text: "Several digital copies are waiting; choose a copy",
        });
    }
  } else if (free.length) {
    const compatible = free.filter((copy) => {
      const edition = editions.get(copy.editionId)!;
      return (
        !!language &&
        (normalizeLanguage(edition.language) === language ||
          (edition.metadataSource === "phantom_canon" &&
            edition.language === "en"))
      );
    });
    if (free.length > 1) {
      rule = "fill_copy";
      ambiguities.push({
        code: "multiple_copies",
        text: "Several digital copies are waiting; choose a copy",
      });
    } else if (compatible.length === 1) {
      rule = "fill_copy";
      instanceId = compatible[0].id;
      editionId = compatible[0].editionId;
    }
  }
  if (!editionId && !ambiguities.length) {
    const freeIsbns = ids.isbns.filter(
      (isbn) =>
        !catalogue.isbnEditionIds.has(isbn) && !catalogue.sharedIsbns.has(isbn),
    );
    if (
      ids.isbns.some(
        (isbn) =>
          catalogue.sharedIsbns.has(isbn) || catalogue.isbnEditionIds.has(isbn),
      )
    )
      ambiguities.push({
        code: "isbn_held",
        text: "An ISBN is shared or held by another edition; review before creating an edition",
      });
    if (freeIsbns.length) {
      rule = "new_isbn_edition";
      if (freeIsbns.length === 1) isbn13 = freeIsbns[0];
      else
        ambiguities.push({
          code: "multiple_isbns",
          text: "Several ISBNs are present; choose the ebook edition's ISBN",
        });
    } else {
      const placeholders = source.editions.filter(
        (edition) =>
          edition.metadataSource === "phantom_canon" &&
          !!language &&
          normalizeLanguage(edition.language) === language,
      );
      if (placeholders.length === 1) {
        rule = "placeholder_copy";
        editionId = placeholders[0].id;
      } else if (placeholders.length > 1)
        ambiguities.push({
          code: "multiple_placeholders",
          text: "Several placeholder editions have this language; choose an edition",
        });
    }
  }
  if (editionId && editions.get(editionId)!.metadataLocked)
    ambiguities.push({
      code: "locked_edition",
      text: "This edition is locked; review before linking",
    });
  if (movedFromEditionId && editions.get(movedFromEditionId)!.metadataLocked)
    ambiguities.push({
      code: "locked_edition",
      text: "The placeholder edition is locked; review before moving its copy",
    });
  const createsEdition = rule === "new_edition" || rule === "new_isbn_edition";
  if (createsEdition && !language) missing.push("language");
  const newEdition: NewEditionEffect | null =
    createsEdition && language
      ? {
          title: titleKeys(
            ebook.title,
            ebook.subtitle,
            ebook.language,
            ebook.series,
          ).cleaned,
          subtitle: ebook.subtitle ?? null,
          language,
          isbn13,
          publisher: ebook.publisher ?? null,
          publicationYear: ebook.publishedYear ?? null,
          metadataSource: "ebook",
          coverSourceKey: file?.coverKey ?? null,
        }
      : null;
  const newCopy =
    !instanceId && file && catalogue.source.ebookLocationId
      ? {
          locationId: catalogue.source.ebookLocationId,
          format:
            file.format === "epub" || file.format === "kepub"
              ? ("epub" as const)
              : file.format === "pdf"
                ? ("pdf" as const)
                : ("ebook" as const),
          fileSizeBytes: file.sizeBytes,
          status: "available" as const,
        }
      : null;
  const text =
    missing.length || ambiguities.length
      ? `Needs review before linking ${source.title}: ${[...missing, ...ambiguities.map((reason) => reason.text)].join("; ")}`
      : movedFromEditionId
        ? `Moves the digital copy to the identified edition of ${source.title} and fills it`
        : instanceId
          ? `Fills the digital copy of ${source.title}`
          : createsEdition
            ? `Adds an edition in ${language}${isbn13 ? ` (ISBN ${isbn13})` : " without an ISBN"} and a digital copy of ${source.title}`
            : `Adds a digital copy of ${source.title}`;
  return {
    workId: source.id,
    rule,
    editionId,
    instanceId,
    movedFromEditionId,
    newEdition,
    newCopy,
    missing,
    ambiguities,
    ready: missing.length === 0 && ambiguities.length === 0,
    text,
  };
}
