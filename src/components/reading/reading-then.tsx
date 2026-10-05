"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { PickerPurpose } from "@/lib/reading/book-picker";
import { useReadingDialogs, type ReadingRef } from "./reading-dialogs-provider";

/**
 * A book page opened with ?then=start, past or quote (SLN-448: a book just
 * added from the book picker, the next volume after a finish): opens that
 * dialog once, then takes `then` out of the address so a refresh or Back does
 * not open it again. Start on a book being read logs progress instead.
 */
export function ReadingThen({ workId, then, openReading }: { workId: string; then: PickerPurpose; openReading: ReadingRef | null }) {
  const { open } = useReadingDialogs();
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("then");
    // The dialog first: a navigation while its data loads would let the
    // data's answer bring the old address (and this island) back
    const opening =
      then === "start" && openReading
        ? open({ kind: "progress", ...openReading })
        : then === "quote"
          ? open({ kind: "note", workId, noteKind: "quote", readingId: openReading?.readingId })
          : open({ kind: then, workId });
    void opening.finally(() => router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false }));
  }, [open, router, then, workId, openReading]);
  return null;
}
