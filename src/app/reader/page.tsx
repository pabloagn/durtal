import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCalibreBooks, getRecentlyRead } from "@/lib/calibre/queries";
import { ReaderLibrary } from "./reader-library";

export const metadata: Metadata = {
  title: "Reader",
};

export default async function ReaderPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; perPage?: string }>;
}) {
  const params = await searchParams;
  const q = params.q;
  const { page: currentPage, perPage: limit, offset } = parsePagination(params);

  const [{ books, total }, recentlyRead] = await Promise.all([
    getCalibreBooks({ query: q, limit, offset }),
    getRecentlyRead(6),
  ]);

  if (currentPage > lastPage(total, limit)) redirect(pageHref("/reader", params, lastPage(total, limit)));

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
