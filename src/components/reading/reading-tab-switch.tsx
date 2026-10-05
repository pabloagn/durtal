"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AUTHOR_READING_TABS, type AuthorReadingTab } from "@/lib/reading/record";

/**
 * All, Unread, Reading, Read over a person's books (SLN-449): the choice is
 * `?reading=` in the address, so the server filters and pages the books.
 */
export function ReadingTabSwitch({ value }: { value: AuthorReadingTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <SegmentedControl
      options={AUTHOR_READING_TABS}
      value={value}
      ariaLabel="Books by reading"
      onChange={(next) => {
        const query = new URLSearchParams(params.toString());
        if (next === "all") query.delete("reading");
        else query.set("reading", next);
        query.delete("page");
        const qs = query.toString();
        router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      }}
    />
  );
}
