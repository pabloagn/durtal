import type { NextRequest } from "next/server";
import { handleReviewUnlinkRoute } from "@/lib/api/ebook-review";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleReviewUnlinkRoute(req, params, "confirm");
}
