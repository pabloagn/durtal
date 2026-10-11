import type { NextRequest } from "next/server";
import { handleReviewUndoRoute } from "@/lib/api/ebook-review";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleReviewUndoRoute(req, params);
}
