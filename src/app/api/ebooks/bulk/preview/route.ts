import type { NextRequest } from "next/server";
import { handleReviewSelectionPrepareRoute } from "@/lib/api/ebook-review";
export async function POST(req: NextRequest) { return handleReviewSelectionPrepareRoute(req); }
