import type { NextRequest } from "next/server";
import { handleWorkReviewRoute } from "@/lib/api/ebook-review";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleWorkReviewRoute(req, params, "undo");
}
