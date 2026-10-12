import type { NextRequest } from "next/server";
import { handleUploadPart } from "@/lib/api/ebook-upload";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(req: NextRequest, { params }: { params: Promise<{ operationId: string; part: string }> }) {
  const { operationId, part } = await params; return handleUploadPart(req, operationId.toLowerCase(), part);
}
