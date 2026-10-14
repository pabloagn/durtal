import { cookies } from "next/headers";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import { parseEbookLibraryParams } from "./library-params";
import { getContinueReading, getEbooksPage, readableFiles, type LibraryEbook } from "./library-queries";
import { continueTarget } from "./continue-target";
import { catalogueContinueDTO, workEbookDTO } from "./catalogue-dto";
import { isEbookFormat } from "./formats";
import type { PaletteEbook } from "./palette-group";

function metadata(ebook: LibraryEbook, descriptor = continueTarget({
  ebookId: ebook.id, preferredFileId: ebook.preferredFileId, excluded: ebook.matchState === "excluded",
  deviceId: null, files: ebook.files, positions: [],
}), title = ebook.title) {
  return workEbookDTO({ ebookId: ebook.id, title, editionId: "", editionLanguage: ebook.language,
    editionYear: null, formats: readableFiles(ebook).map((file) => file.format).filter(isEbookFormat),
    continue: catalogueContinueDTO(descriptor) });
}
/**
 * Uses SLN-497's actual bounded library search. A linked eBook goes by its
 * book's title, and the palette lists it only when its book is not already
 * among the Books (SLN-683), so a few more rows are read than are shown.
 */
export async function paletteEbooks(query: string): Promise<PaletteEbook[]> {
  const params = parseEbookLibraryParams({ q: query });
  const rows = await getEbooksPage({ ...params, perPage: 10, page: 1, offset: 0 });
  return rows.map((ebook) => ({ ebook: metadata(ebook, undefined, ebook.bookTitle ?? ebook.title),
    matchState: ebook.matchState, workId: ebook.bookId ?? null }));
}
export async function paletteContinueReading() {
  const rawDevice = (await cookies()).get(DEVICE_COOKIE)?.value;
  const rows = await getContinueReading(isDeviceId(rawDevice) ? rawDevice : null);
  const recent = rows[0];
  return recent ? metadata(recent.ebook, recent.descriptor, recent.bookTitle ?? recent.ebook.title) : null;
}
