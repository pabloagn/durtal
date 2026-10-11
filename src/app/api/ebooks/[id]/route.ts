import { NextRequest, NextResponse } from "next/server";
import { UUID_RE, errorResponse } from "@/lib/api/rest";
import { getEbookDetail } from "@/lib/ebooks/library-queries";
import { publicEbookDetailDTO } from "@/lib/ebooks/public-dto";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    const ebook = await getEbookDetail(id);
    return ebook ? NextResponse.json(publicEbookDetailDTO(ebook)) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) { return errorResponse(error, "Failed to fetch eBook"); }
}
