import { narrationRoutes } from "@/lib/reader/narration/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One sentence read by the natural voice, as audio (src/lib/reader/narration/) */
export function POST(req: Request) {
  return narrationRoutes.POST(req);
}
