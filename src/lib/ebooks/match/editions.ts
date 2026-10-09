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
  options: {
    instanceId?: string;
    editionId?: string;
    locationId?: string;
  } = {},
): LinkEffect {
  const { source } = work;
  const copyLocation = options.locationId ?? catalogue.source.ebookLocationId;
  const language = normalizeLanguage(ebook.language);
  const file = preferredMatchFile(ebook);
  const ids = identifierKeys(ebook.isbns, ebook.identifiers);
  const title = titleKeys(
    ebook.title,
    ebook.subtitle,
    ebook.language,
    ebook.series,
  );
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
  if (!copyLocation && !options.instanceId) missing.push("ebook_location");
  let rule: EditionRule = "new_edition";
  let editionId: string | null = null;
  let instanceId: string | null = null;
  let movedFromEditionId: string | null = null;
  let isbn13: string | null = null;
  if (options.instanceId || options.editionId) {
    const selectedCopy = options.instanceId
      ? source.copies.find((copy) => copy.id === options.instanceId)
      : null;
    const selected = source.editions.find(
      (edition) =>
        edition.id === (selectedCopy?.editionId ?? options.editionId),
    );
    const destination =
      selectedCopy?.locationId ??
      options.locationId ??
      catalogue.source.ebookLocationId;
    const digital =
      catalogue.source.digitalLocationIds ??
      [catalogue.source.ebookLocationId].filter((id): id is string => !!id);
    if (
      !selected ||
      (options.instanceId && !selectedCopy) ||
      (options.editionId && selected?.id !== options.editionId)
    )
      ambiguities.push({
        code: "copy_choice",
        text: "The chosen copy and edition must belong to this book",
      });
    else {
      editionId = selected.id;
      instanceId = selectedCopy?.id ?? null;
      rule = selectedCopy
        ? "fill_copy"
        : selected.metadataSource === "phantom_canon"
          ? "placeholder_copy"
          : "isbn_edition";
      if (
        selectedCopy?.linkedEbookId ||
        selectedCopy?.status === "deaccessioned"
      )
        ambiguities.push({
          code: "copy_taken",
          text: "The chosen digital copy is already linked or deaccessioned",
        });
      if (!destination || !digital.includes(destination))
        ambiguities.push({
          code: "digital_location",
          text: "Choose an active digital location",
        });
      if (
        language &&
        normalizeLanguage(selected.language) !== language &&
        !(
          selected.metadataSource === "phantom_canon" &&
          selected.language === "en"
        )
      )
        ambiguities.push({
          code: "edition_language",
          text: "The chosen edition has another language",
        });
      if (identified.some((edition) => edition.id !== selected.id))
        ambiguities.push({
          code: "edition_identifier",
          text: "An identifier names another edition; review the copy choice",
        });
    }
  } else if (identified.length) {
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
  // Validate the actual destination and any copy being moved, including routes
  // chosen without identifiers. A tied unnumbered work title is not evidence
  // that these editions describe the same volume.
  const editionNumbers = new Map(
    source.editions.map((edition) => [
      edition.id,
      titleKeys(edition.title, edition.subtitle, edition.language).numbers,
    ]),
  );
  const selectedNumbers = [editionId, movedFromEditionId]
    .filter((id): id is string => !!id)
    .map((id) => editionNumbers.get(id)!)
    .filter(Boolean);
  const workNumbers = [
    titleKeys(source.title, null, source.originalLanguage).numbers,
    source.originalTitle
      ? titleKeys(source.originalTitle, null, source.originalLanguage).numbers
      : "",
  ].filter(Boolean);
  const catalogueNumbers = new Set(
    work.titles.map((key) => key.numbers).filter(Boolean),
  );
  const identifiedResolvesVolume =
    ((identified.length === 1 && editionId === identified[0].id) ||
      !!(options.instanceId || options.editionId)) &&
    (!title.numbers ||
      (!!editionId && editionNumbers.get(editionId) === title.numbers));
  const relevantNumbers = [
    ...workNumbers,
    ...selectedNumbers,
    ...(!identifiedResolvesVolume ? catalogueNumbers : []),
  ];
  if (
    new Set(selectedNumbers).size > 1 ||
    (title.numbers &&
      relevantNumbers.some((numbers) => numbers !== title.numbers))
  )
    ambiguities.push({
      code: "number_signature",
      text: "The file, selected edition or copy names a different numbered volume or year",
    });
  if (catalogueNumbers.size > 1 && !identifiedResolvesVolume)
    ambiguities.push({
      code: "multiple_volume_signatures",
      text: "This work has different numbered volumes; choose and confirm the edition",
    });
  const createsEdition = rule === "new_edition" || rule === "new_isbn_edition";
  if (createsEdition && !language) missing.push("language");
  const newEdition: NewEditionEffect | null =
    createsEdition && language
      ? {
          title: title.cleaned,
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
    !instanceId && file && copyLocation
      ? {
          locationId: copyLocation,
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
