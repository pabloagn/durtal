import type { NextRequest } from "next/server";
import { handleUploadCommand, handleUploadItem } from "@/lib/api/ebook-upload";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, { params }: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await params; return handleUploadCommand(req, operationId.toLowerCase());
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await params; return handleUploadItem(req, operationId.toLowerCase());
}
