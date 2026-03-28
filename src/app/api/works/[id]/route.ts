import { NextRequest, NextResponse } from "next/server";
import { getWork } from "@/lib/actions/works";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const work = await getWork(id);
    if (!work) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(work);
  } catch {
    return NextResponse.json({ error: "Failed to fetch work" }, { status: 500 });
  }
}
