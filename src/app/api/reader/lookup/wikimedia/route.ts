import { createWikimediaRelay } from "@/lib/api/reader-wikimedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createWikimediaRelay();
