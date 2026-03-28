import { NextRequest, NextResponse } from "next/server";
import { getPresignedUploadUrl, getPresignedReadUrl } from "@/lib/s3/covers";

export async function POST(req: NextRequest) {
  try {
    const { key, contentType, action } = await req.json();

    if (!key || typeof key !== "string") {
      return NextResponse.json(
        { error: "Missing 'key' parameter" },
        { status: 400 },
      );
    }

    if (action === "read") {
      const url = await getPresignedReadUrl(key);
      return NextResponse.json({ url });
    }

    // Default: upload
    if (!contentType || typeof contentType !== "string") {
      return NextResponse.json(
        { error: "Missing 'contentType' for upload" },
        { status: 400 },
      );
    }

    const url = await getPresignedUploadUrl(key, contentType);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate pre-signed URL" },
      { status: 500 },
    );
  }
}
