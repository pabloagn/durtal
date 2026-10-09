import type { TocItem } from "@/lib/reader/engine";
import type { FoliateBook } from "./foliate";
/** Manifest hrefs are already resolved against the package document. */
export function findPageMap(
  book: Pick<FoliateBook, "resources">,
): string | null {
  const resources = book.resources;
  if (!resources) return null;
  const spine = [...resources.opf.getElementsByTagName("*")].find(
    (element) => element.localName === "spine",
  );
  const id = spine?.getAttribute("page-map");
  return (
    (id ? resources.getItemByID(id)?.href : null) ??
    resources.manifest.find(
      (item) => item.mediaType === "application/oebps-page-map+xml",
    )?.href ??
    null
  );
}
export function parsePageMap(xml: string, mapHref: string): TocItem[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];
  return [...doc.getElementsByTagName("*")]
    .filter((element) => element.localName === "page")
    .flatMap((page) => {
      const label = page.getAttribute("name")?.trim();
      const href = page.getAttribute("href")?.trim();
      if (!label || !href) return [];
      try {
        const url = new URL(href, new URL(mapHref, "https://reader.invalid/"));
        if (url.origin !== "https://reader.invalid") return [];
        return [
          {
            label,
            href: decodeURI(url.pathname.slice(1) + url.hash),
            subitems: [],
          },
        ];
      } catch {
        return [];
      }
    });
}
