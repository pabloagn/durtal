import { NextResponse } from "next/server";
import { z } from "zod";
import {
  mediaAttributionSchema,
  monochromeParamsSchema,
  type MediaAttribution,
  type MonochromeParams,
} from "@/lib/validations/media";
import { MediaIngestError } from "./ingest";

/** Thrown for request details the caller must correct. */
class InvalidInput extends Error {}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new InvalidInput("The image details are not valid JSON");
  }
}

/** Optional alt text, credit, license and source; invalid details are refused. */
export function parseAttribution(value: unknown): MediaAttribution | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return mediaAttributionSchema.parse(json(value));
}

/** Author monochrome settings; anything unreadable falls back to the defaults. */
export function parseParams(value: unknown): MonochromeParams | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  try {
    const parsed = monochromeParamsSchema.safeParse(json(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A response for a request the caller can correct, or null for a server fault. */
export function ingestRefusal(error: unknown): NextResponse | null {
  if (error instanceof MediaIngestError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: "The image details are not valid" },
      { status: 400 },
    );
  if (error instanceof InvalidInput)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return null;
}
