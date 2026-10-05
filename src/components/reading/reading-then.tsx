"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { PickerPurpose } from "@/lib/reading/book-picker";
import { useReadingDialogs, type ReadingRef } from "./reading-dialogs-provider";

/**
 * A book page opened with ?then=start or ?then=past (SLN-448: a book just
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
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    if (then === "start" && openReading) void open({ kind: "progress", ...openReading });
    else void open({ kind: then, workId });
  }, [open, router, then, workId, openReading]);
  return null;
}
