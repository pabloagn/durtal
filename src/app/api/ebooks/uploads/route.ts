import type { NextRequest } from "next/server";
import { handleUploadCreate } from "@/lib/api/ebook-upload";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(req: NextRequest) { return handleUploadCreate(req); }
