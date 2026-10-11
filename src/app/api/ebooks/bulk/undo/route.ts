import type { NextRequest } from "next/server";
import { handleReviewSelectionUndoRoute } from "@/lib/api/ebook-review";
export async function POST(req: NextRequest) { return handleReviewSelectionUndoRoute(req); }
