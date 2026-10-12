import type { NextRequest } from "next/server";
import { handleReviewSelectionConfirmRoute } from "@/lib/api/ebook-review";
export async function POST(req: NextRequest) { return handleReviewSelectionConfirmRoute(req); }
