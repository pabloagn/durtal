import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/rest";
import { parseEbookLibraryParams } from "@/lib/ebooks/library-params";
import { getEbookLibraryCounts, getEbooksPage } from "@/lib/ebooks/library-queries";
import { publicEbookDTO } from "@/lib/ebooks/public-dto";

export async function GET(request: NextRequest) {
  try {
    const params = parseEbookLibraryParams(request.nextUrl.searchParams);
    const [rows, counts] = await Promise.all([getEbooksPage(params), getEbookLibraryCounts(params)]);
    return NextResponse.json({ ebooks: rows.map(publicEbookDTO), total: counts.total, page: params.page, perPage: params.perPage });
  } catch (error) { return errorResponse(error, "Failed to fetch eBooks"); }
}
