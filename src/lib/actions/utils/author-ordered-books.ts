import { and, asc, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { workAuthors } from "@/lib/db/schema";
import { bookCondition } from "@/lib/catalogue/book-boundary";
import { compareWorks } from "@/lib/utils/title-order";

/** Match the library's name ordering before paging; load artwork only afterward. */
export async function authorOrderedBookIds(
  where: SQL | undefined,
  sort: "authorFirstName" | "authorLastName",
  order: "asc" | "desc",
  limit: number,
  offset: number,
) {
  const matches = await db.query.works.findMany({
    where: and(bookCondition, where),
    columns: { id: true, title: true },
    with: {
      workAuthors: {
        columns: {},
        orderBy: [asc(workAuthors.sortOrder), asc(workAuthors.authorId)],
        limit: 1,
        with: {
          author: { columns: { name: true, firstName: true, sortName: true } },
        },
      },
    },
  });
  function name(work: (typeof matches)[number]) {
    const author = work.workAuthors[0]?.author;
    return (
      sort === "authorFirstName"
        ? author?.firstName || author?.name.split(/\s+/)[0] || ""
        : author?.sortName?.split(",")[0] ||
          author?.name.split(/\s+/).pop() ||
          ""
    ).toLowerCase();
  }
  return matches
    .sort((a, b) => {
      const compared = name(a).localeCompare(name(b));
      return (
        (order === "desc" ? -compared : compared) || compareWorks(a, b, order)
      );
    })
    .slice(offset, offset + limit)
    .map((work) => work.id);
}
