import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { generateWorkSlug } from "@/lib/utils/slugify";
import {
  refreshWorkSlug,
  slugFitsBase,
  type SlugChange,
} from "@/lib/works/slug";
import { UUID_RE, errorResponse, requireApiToken } from "@/lib/api/rest";

/**
 * POST /api/works/refresh-slugs[?dryRun=1][&id=<work id>]
 *
 * Gives every work whose slug no longer fits its title and primary author
 * the slug it should have (renames before task 0175 kept the old one).
 * `dryRun=1` lists the changes and writes nothing. `id` limits the run to one
 * work. Safe to run again: fitting slugs are left alone.
 */
export async function POST(req: NextRequest) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
    const onlyId = req.nextUrl.searchParams.get("id");
    if (onlyId && !UUID_RE.test(onlyId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const rows = await db.query.works.findMany({
      where: onlyId ? (w, { eq }) => eq(w.id, onlyId) : undefined,
      columns: { id: true, title: true, slug: true },
      with: {
        workAuthors: {
          columns: {},
          with: { author: { columns: { name: true } } },
          orderBy: (wa) => asc(wa.sortOrder),
          limit: 1,
        },
      },
    });
    const candidates = rows.filter(
      (w) =>
        !slugFitsBase(
          w.slug,
          generateWorkSlug(w.title, w.workAuthors[0]?.author.name ?? "unknown", w.id),
        ),
    );

    const changes: SlugChange[] = [];
    for (const w of candidates) {
      const change = await refreshWorkSlug(w.id, { apply: !dryRun });
      if (change) changes.push(change);
    }
    if (!dryRun && changes.length > 0) {
      invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
    }

    return NextResponse.json({
      dryRun,
      checked: rows.length,
      changed: changes.length,
      changes,
    });
  } catch (err) {
    return errorResponse(err, "Failed to refresh slugs");
  }
}
