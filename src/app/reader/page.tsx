import type { Metadata } from "next";
import { getCalibreBooks, getRecentlyRead } from "@/lib/calibre/queries";
import { ReaderLibrary } from "./reader-library";

export const metadata: Metadata = {
  title: "Reader",
};

export default async function ReaderPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page } = await searchParams;
  const currentPage = parseInt(page ?? "1", 10);
  const limit = 48;
  const offset = (currentPage - 1) * limit;

  const [{ books, total }, recentlyRead] = await Promise.all([
    getCalibreBooks({ query: q, limit, offset }),
    getRecentlyRead(6),
  ]);

  return (
    <ReaderLibrary
      books={books}
      total={total}
      currentPage={currentPage}
      limit={limit}
      query={q ?? ""}
      recentlyRead={recentlyRead}
    />
  );
}
