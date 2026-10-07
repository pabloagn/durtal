import { cache } from "react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/utils/uuid";
import { formatLabel } from "@/lib/ebooks/formats";
import { readReaderBook, type ReaderFile } from "@/lib/ebooks/delivery/reader-book";
import { fileUrlFor } from "@/lib/ebooks/delivery/url";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import type { DurtalLocator, ReaderFormat } from "@/lib/reader/engine";
import { firstRange, prefetchScript } from "@/lib/reader/first-range";
import { zipCdOffset } from "@/lib/reader/manifest";
import { loadReaderPlugins } from "./plugins";
import { ReaderView, type ReaderViewFile } from "./reader-view";

type PageProps = {
  params: Promise<{ ebookId: string }>;
  searchParams: Promise<{ file?: string | string[] }>;
};

const ZIP_FORMATS = new Set(["epub", "kepub", "fbz", "cbz"]);

const loadBook = cache((ebookId: string, deviceId: string | null, fileId: string | null) =>
  readReaderBook(ebookId, { deviceId, fileId }),
);

async function readRequest({ params, searchParams }: PageProps) {
  const { ebookId } = await params;
  if (!isUuid(ebookId)) notFound();
  const { file } = await searchParams;
  const device = (await cookies()).get(DEVICE_COOKIE)?.value;
  return {
    ebookId: ebookId.toLowerCase(),
    fileId: typeof file === "string" && isUuid(file) ? file.toLowerCase() : null,
    deviceId: isDeviceId(device) ? device : null,
  };
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
    delivery = { url: signed.url, expiresAt: signed.expiresAt?.toISOString() ?? null };
  } catch (err) {
    console.error("[reader] No delivery URL, reading through the app:", err);
    delivery = { url: fallbackUrl, expiresAt: null };
  }
  const cdOffset = ZIP_FORMATS.has(file.format) ? await zipCdOffset(file) : null;
  return {
    id: file.id,
    format: file.format as ReaderFormat,
    size: file.sizeBytes,
    sha256: file.sha256,
    url: delivery.url,
    expiresAt: delivery.expiresAt,
    fallbackUrl,
    cdOffset,
  };
}

/**
 * /reader/[ebookId] — the reading view (eBooks sub-issue 3). One query
 * gives the e-book, its readable files, the file to open (`?file=`
 * overrides the preferred one) and this device's place in it; the reader's
 * plug-ins load alongside. An inline script starts the file's first byte
 * range as the HTML arrives, while the engine's code downloads.
 */
export default async function ReaderPage(props: PageProps) {
  const request = await readRequest(props);
  const [book, plugins] = await Promise.all([
    loadBook(request.ebookId, request.deviceId, request.fileId),
    loadReaderPlugins(request),
  ]);
  if (!book) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const file = book.file ? await viewFile(book.file) : null;
  const range = file ? firstRange(file.format, file.size, file.cdOffset) : null;
  return (
    <>
      {file && range && (
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: prefetchScript({ fileId: file.id, url: file.url, range }) }}
        />
      )}
      <ReaderView
        ebook={{ id: book.id, title: book.title, authors: book.authors }}
        file={file}
        alternatives={book.files
          .filter((f) => f.id !== file?.id)
          .map((f) => ({ id: f.id, label: formatLabel(f.format) }))}
        place={(book.place?.locator as DurtalLocator | undefined) ?? null}
        backHref={book.workSlug ? `/library/${book.workSlug}` : "/library"}
        plugins={plugins}
      />
    </>
  );
}
