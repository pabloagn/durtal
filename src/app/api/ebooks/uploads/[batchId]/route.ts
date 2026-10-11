import type { NextRequest } from "next/server";
import { handleUploadBatch } from "@/lib/api/ebook-upload";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params; return handleUploadBatch(req, batchId.toLowerCase());
}
