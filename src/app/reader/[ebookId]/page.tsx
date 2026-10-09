import { cache } from "react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { isUuid } from "@/lib/utils/uuid";
import { formatLabel } from "@/lib/ebooks/formats";
import {
  readReaderBook,
  type ReaderFile,
} from "@/lib/ebooks/delivery/reader-book";
import { fileUrlFor } from "@/lib/ebooks/delivery/url";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import type { ReaderFormat } from "@/lib/reader/engine";
import {
  PDF_WORKER_URL,
  firstRanges,
  prefetchScript,
} from "@/lib/reader/first-range";
import { readerLatinFace } from "@/lib/reader/fonts";
import { zipCdOffset } from "@/lib/reader/manifest";
import { readerSettings } from "@/lib/reader/settings-cookie";
import { READER_SETTINGS_KEY } from "@/lib/preferences";
import { loadReaderPlugins } from "./plugins";
import { ReaderView, type ReaderViewFile } from "./reader-view";

type PageProps = {
  params: Promise<{ ebookId: string }>;
  searchParams: Promise<{ file?: string | string[] }>;
};

const ZIP_FORMATS = new Set(["epub", "kepub", "fbz", "cbz"]);

const loadBook = cache(
  (ebookId: string, deviceId: string | null, fileId: string | null) =>
    readReaderBook(ebookId, { deviceId, fileId }),
);

async function readRequest({ params, searchParams }: PageProps) {
  const { ebookId } = await params;
  if (!isUuid(ebookId)) notFound();
  const { file } = await searchParams;
  const jar = await cookies();
  const device = jar.get(DEVICE_COOKIE)?.value;
  return {
    ebookId: ebookId.toLowerCase(),
    fileId:
      typeof file === "string" && isUuid(file) ? file.toLowerCase() : null,
    deviceId: isDeviceId(device) ? device : null,
    settingsCookie: jar.get(READER_SETTINGS_KEY)?.value ?? null,
  };
}

/**
 * The reading font, asked for with the page: the first page is then laid
 * out once, in it. A PDF or a comic is pictures of its pages and never uses it.
 */
function preloadReadingFont(
  settingsCookie: string | null,
  format: ReaderFormat,
) {
  if (format === "pdf" || format === "cbz") return;
  let stored: unknown = null;
  try {
    stored = settingsCookie ? JSON.parse(settingsCookie) : null;
  } catch {
    // A damaged cookie gives the defaults
  }
  const face = readerLatinFace(readerSettings(stored).fontFamily);
  if (face)
    preload(face, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { ebookId, deviceId, fileId } = await readRequest(props);
  const book = await loadBook(ebookId, deviceId, fileId);
  return { title: book ? book.title : "eBook not found" };
}

/** Where the bytes are: the CDN or the app route, and the app route as the fallback */
async function viewFile(file: ReaderFile): Promise<ReaderViewFile> {
  const fallbackUrl = `/api/ebooks/files/${file.id}`;
  let delivery: { url: string; expiresAt: string | null };
  try {
    const signed = fileUrlFor(file);
    delivery = {
      url: signed.url,
      expiresAt: signed.expiresAt?.toISOString() ?? null,
    };
  } catch (err) {
    console.error("[reader] No delivery URL, reading through the app:", err);
    delivery = { url: fallbackUrl, expiresAt: null };
  }
  const cdOffset = ZIP_FORMATS.has(file.format)
    ? await zipCdOffset(file)
    : null;
  return {
    id: file.id,
    format: file.format as ReaderFormat,
    size: file.sizeBytes,
    sha256: file.sha256,
    url: delivery.url,
    expiresAt: delivery.expiresAt,
    fallbackUrl,
    cdOffset,
    charCount: file.charCount,
  };
}

/**
 * /reader/[ebookId] — the reading view (eBooks sub-issue 3). One query
 * gives the e-book, its readable files, the file to open (`?file=`
 * overrides the preferred one) and this device's place in it; the reader's
 * plug-ins load alongside. An inline script starts the file's first byte
 * ranges as the HTML arrives, while the engine's code downloads (and, for
 * a PDF, pdf.js's worker after them), and the reading font is preloaded.
 */
export default async function ReaderPage(props: PageProps) {
  const request = await readRequest(props);
  const [bookResult, pluginsResult] = await Promise.allSettled([
    loadBook(request.ebookId, request.deviceId, request.fileId),
    loadReaderPlugins(request),
  ]);
  if (bookResult.status === "rejected") throw bookResult.reason;
  const book = bookResult.value;
  if (!book) notFound();
  const plugins =
    pluginsResult.status === "fulfilled" ? pluginsResult.value : [];
  if (pluginsResult.status === "rejected")
    console.error("[reader] Plug-in loading failed:", pluginsResult.reason);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const file = book.file ? await viewFile(book.file) : null;
  if (file) preloadReadingFont(request.settingsCookie, file.format);
  const ranges = file ? firstRanges(file.format, file.size, file.cdOffset) : [];
  const worker = file?.format === "pdf" ? PDF_WORKER_URL : undefined;
  return (
    <>
      {file && ranges.length > 0 && (
        <script
          nonce={nonce}
          // Browsers hide a nonce from the DOM once it is used, so hydration sees nonce=""
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: prefetchScript({
              fileId: file.id,
              url: file.url,
              ranges,
              worker,
            }),
          }}
        />
      )}
      <ReaderView
        ebook={{
          id: book.id,
          title: book.title,
          authors: book.authors,
          language: book.language,
        }}
        file={file}
        alternatives={book.files
          .filter((f) => f.id !== file?.id)
          .map((f) => ({ id: f.id, label: formatLabel(f.format) }))}
        place={book.place}
        devicePlace={book.devicePlace}
        otherPlace={book.otherPlace}
        deviceId={request.deviceId}
        backHref={book.workSlug ? `/library/${book.workSlug}` : "/library"}
        plugins={plugins}
      />
    </>
  );
}
