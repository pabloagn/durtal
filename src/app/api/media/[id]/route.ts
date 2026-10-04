import { NextRequest, NextResponse } from "next/server";
import { deleteMedia } from "@/lib/actions/media";
import { isUuid } from "@/lib/utils/uuid";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid media id" }, { status: 400 });
    }
    await deleteMedia(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/media/:id] Delete failed:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
