import type { NextRequest } from "next/server";
import { handleReviewReadRoute } from "@/lib/api/ebook-review";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleReviewReadRoute(req, params);
}
