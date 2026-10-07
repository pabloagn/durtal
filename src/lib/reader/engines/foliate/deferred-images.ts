import type { ZipLoader } from "./foliate";
import { imageSize } from "./image-size";

/** An image this large or larger waits for the text */
export const DEFER_IMAGE_BYTES = 96 * 1024;
/** Enough of an image's start for its size, past a JPEG's EXIF block */
const HEAD_BYTES = 60 * 1024;
const DEFERRED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const XLINK = "http://www.w3.org/1999/xlink";

/** What foliate-js's EPUB loader asks before it loads a resource; `url` answers for it */
interface LoadDetail {
  type: string;
  href: string;
  allow: boolean;
  url?: Promise<string>;
}

/**
 * Large images in a reflowable EPUB come after the text (eBooks
 * sub-issue 3). foliate-js puts every image of a section into the page
 * before it shows it, so a 10 MB plate at the head of a chapter held its
 * first page back for every byte. Here a large image is first a blank of its
 * own size, read from its first bytes, which the section lays out and shows
 * at once; when the section's document has loaded, each blank gets its
 * image, and the page does not move. An image whose size cannot be read
 * loads as before.
 */
export class DeferredImages {
  #placeholders = new Map<string, { href: string; type: string }>();
  /** Image URLs made here, not by foliate-js: revoked here */
  #owned = new Set<string>();

  constructor(private readonly loader: ZipLoader) {}

  /** Listens on the book's loader events (foliate-js's `transformTarget`) */
  attach(target: EventTarget) {
    target.addEventListener("load", (event) => {
      const detail = (event as CustomEvent<LoadDetail>).detail;
      if (!DEFERRED_TYPES.has(detail.type) || this.loader.getSize(detail.href) < DEFER_IMAGE_BYTES) return;
      detail.url = this.#placeholder(detail.href, detail.type);
    });
  }

  async #placeholder(href: string, type: string): Promise<string> {
    const head = await this.loader.readHead?.(href, HEAD_BYTES);
    const size = head ? imageSize(head) : null;
    if (!size) return this.#image(href, type);
    const { width, height } = size;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"/>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    this.#placeholders.set(url, { href, type });
    return url;
  }

  async #image(href: string, type: string): Promise<string> {
    const blob = await this.loader.loadBlob(href, type);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    this.#owned.add(url);
    return url;
  }

  #revoke(url: string) {
    URL.revokeObjectURL(url);
    this.#owned.delete(url);
  }

  /** A section's document has loaded: each blank gets its image, freed when the section goes */
  fill(doc: Document) {
    const filled: string[] = [];
    let gone = false;
    doc.defaultView?.addEventListener(
      "pagehide",
      () => {
        gone = true;
        filled.forEach((url) => this.#revoke(url));
      },
      { once: true },
    );
    const swap = (wanted: { href: string; type: string }, set: (url: string) => void) => {
      void this.#image(wanted.href, wanted.type)
        .then((url) => {
          if (!url) return;
          if (gone) return this.#revoke(url);
          set(url);
          filled.push(url);
        })
        .catch(() => {});
    };
    for (const img of doc.querySelectorAll("img[src]")) {
      const wanted = this.#placeholders.get(img.getAttribute("src") ?? "");
      if (wanted) swap(wanted, (url) => img.setAttribute("src", url));
    }
    for (const image of doc.querySelectorAll("image")) {
      const plain = this.#placeholders.get(image.getAttribute("href") ?? "");
      if (plain) swap(plain, (url) => image.setAttribute("href", url));
      const linked = this.#placeholders.get(image.getAttributeNS(XLINK, "href") ?? "");
      if (linked) swap(linked, (url) => image.setAttributeNS(XLINK, "xlink:href", url));
    }
  }

  destroy() {
    for (const url of this.#placeholders.keys()) URL.revokeObjectURL(url);
    for (const url of this.#owned) URL.revokeObjectURL(url);
    this.#placeholders.clear();
    this.#owned.clear();
  }
}
