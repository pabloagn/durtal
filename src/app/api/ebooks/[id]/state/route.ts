import type { NextRequest } from "next/server";
import { handleReviewDecisionRoute } from "@/lib/api/ebook-review";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleReviewDecisionRoute(req, params, ["keep", "exclude", "restore", "rematch"]);
}
