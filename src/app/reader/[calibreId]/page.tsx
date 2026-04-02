import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getCalibreBookById,
  getReadingProgress,
} from "@/lib/calibre/queries";
import { ReaderView } from "./reader-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ calibreId: string }>;
}): Promise<Metadata> {
  const { calibreId } = await params;
  const id = parseInt(calibreId, 10);
  if (isNaN(id)) return { title: "Reader" };

  const book = await getCalibreBookById(id);
  return {
    title: book ? `${book.title} | Reader` : "Reader",
  };
}

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ calibreId: string }>;
}) {
  const { calibreId } = await params;
  const id = parseInt(calibreId, 10);
  if (isNaN(id)) notFound();

  const book = await getCalibreBookById(id);
  if (!book) notFound();

  const progress = await getReadingProgress(book.id);

  // Determine the best available format
  const formats = book.formats ?? [];
  const epubFormat = formats.find(
    (f) => f.format.toLowerCase() === "epub",
  );
  const pdfFormat = formats.find(
    (f) => f.format.toLowerCase() === "pdf",
  );
  const bestFormat = epubFormat ?? pdfFormat ?? formats[0];

  if (!bestFormat) notFound();

  const bookUrl = `/api/reader/${book.calibreId}/file?format=${bestFormat.format.toLowerCase()}`;
  const author = book.authorSort ?? "Unknown Author";

  return (
    <ReaderView
      bookUrl={bookUrl}
      title={book.title}
      author={author}
      calibreId={book.calibreId}
      initialCfi={progress?.currentCfi ?? null}
      initialProgress={progress?.progressPercent ?? 0}
      initialChapter={progress?.currentChapter ?? ""}
      format={bestFormat.format.toLowerCase()}
    />
  );
}
