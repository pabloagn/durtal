import type { ComicModule, FoliateBook, ZipLoader } from "./foliate";
import { compareComicPaths, comicDirection, comicFolderContents, touchComicPage } from "./comic";
export async function makeDurtalComicBook(loader: ZipLoader, name: string): Promise<FoliateBook> {
  const { makeComicBook } = await import("@/vendor/foliate-js/comic-book.js") as unknown as ComicModule;
  const book = await makeComicBook(loader, { name });
  book.sections.sort((a,b) => compareComicPaths(String(a.id), String(b.id)));
  const paths = book.sections.map(section => String(section.id));
  book.pageList = paths.map((href,index) => ({ href, label: String(index+1) }));
  const folders = comicFolderContents(paths); if (folders.length) book.toc = folders;
  const metadata = loader.entries.find(item => item.filename.split("/").at(-1)?.toLowerCase() === "comicinfo.xml");
  if (metadata) {
    const text = await loader.loadText(metadata.filename);
    if (text) { const xml = new DOMParser().parseFromString(text,"application/xml"); if (!xml.querySelector("parsererror")) book.dir = comicDirection(xml.querySelector("Manga")?.textContent); }
  }
  let recent: number[] = []; let closed = false;
  for (const [index, section] of book.sections.entries()) {
    const load = section.load; let pending: ReturnType<NonNullable<typeof load>> | null = null;
    if (load) section.load = () => {
      if (closed) return Promise.reject(new Error("Comic is closed"));
      if (pending) return pending;
      pending = load().then(value => {
        if (closed) { section.unload?.(); throw new Error("Comic is closed"); }
        const transition = touchComicPage(recent,index); recent = transition.recent;
        for (const evicted of transition.evicted) book.sections[evicted].unload?.();
        return value;
      }).finally(() => { pending = null; });
      return pending;
    };
  }
  const destroy = book.destroy; book.destroy = () => { closed = true; recent = []; destroy?.(); };
  return book;
}
