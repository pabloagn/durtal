import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { errorResponse } from "@/lib/api/rest";
import { requireReadingsToken } from "@/lib/api/readings";
import { getSuggestionContext } from "@/lib/reading/suggest/context";
import { SUGGESTIONS_PER_PAGE, parseSuggestionParams } from "@/lib/reading/suggest/params";
import { predict, predictionText } from "@/lib/reading/suggest/predict";
import { suggest } from "@/lib/reading/suggest/score";

/**
 * GET /api/readings/suggestions (SLN-457): what to read next, the engine of
 * /reading/suggestions for the book enrichment epic's agent. The token is
 * checked first, as on every /api/readings route. The constraints are the
 * page's (scope, length, about, lang, home, skipTypes, noNewSeries, page);
 * an unknown parameter or value answers 400 with the issues. `home` is both
 * the "at hand" home and its filter. Each suggestion comes with its reasons,
 * its score, every feature's part and the ids of its evidence.
 */
export async function GET(req: NextRequest) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  const { params, issues } = parseSuggestionParams(req.nextUrl.searchParams);
  if (issues.length || params.view || params.pick)
    return errorResponse(
      new z.ZodError(
        (issues.length ? issues : [{ path: params.view ? "view" : "pick", message: "Not an API parameter" }]).map((i) => ({ code: "custom" as const, path: [i.path], message: i.message, input: undefined })),
      ),
      "Invalid suggestion constraints",
    );
  try {
    const ctx = await getSuggestionContext({ homeId: params.home ?? null });
    const list = suggest(ctx, params);
    const pages = Math.max(1, Math.ceil(list.length / SUGGESTIONS_PER_PAGE));
    const page = Math.min(params.page, pages);
    return NextResponse.json({
      total: list.length,
      page,
      pages,
      predictions: !!ctx.gate?.on,
      suggestions: list.slice((page - 1) * SUGGESTIONS_PER_PAGE, page * SUGGESTIONS_PER_PAGE).map((s) => {
        const p = ctx.gate?.on ? predict(s.book, ctx) : null;
        return {
          workId: s.book.id,
          title: s.book.title,
          slug: s.book.slug,
          authors: s.book.authors.map((a) => a.name),
          score: s.score,
          reasons: s.reasons,
          prediction: p ? { value: p.value, low: p.low, high: p.high, text: predictionText(p), neighbourIds: p.neighbours.map((x) => x.book.id) } : null,
          features: s.contributions.map((c) => ({
            key: c.key,
            score: c.score,
            share: c.share,
            reason: c.reason,
            meets: c.meets,
            evidenceIds: c.evidence.map((e) => e.id).filter((id): id is string => !!id),
          })),
        };
      }),
    });
  } catch (err) {
    return errorResponse(err, "Could not suggest");
  }
}
