import { narrationRoutes } from "@/lib/reader/narration/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether natural voices are set up, and which (src/lib/reader/narration/) */
export function GET(req: Request) {
  return narrationRoutes.GET(req);
}
