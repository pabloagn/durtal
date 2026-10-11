import type { NextRequest } from "next/server";
import { handleReviewPrepareRoute } from "@/lib/api/ebook-review";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleReviewPrepareRoute(req, params);
}
