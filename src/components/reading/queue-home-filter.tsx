"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { usePreference } from "@/lib/hooks/use-preference";
import { READING_HOME_KEY } from "@/lib/preferences";
import type { HomeOption } from "@/lib/reading/page-data";

/*
 * Up Next's "At hand in Amsterdam" filter (SLN-452): the home is the "I'm at"
 * one the Start dialog remembers on this device. With none, it asks for it.
 */
export function QueueHomeFilter({ home, homes, on }: { home: HomeOption | null; homes: HomeOption[]; on: boolean }) {
  const router = useRouter();
  const [, setHome] = usePreference<string | null>(READING_HOME_KEY, null);
  if (!home)
    return homes.length ? (
      <div className="w-56" data-queue-home="">
        <Select
          label="I'm at"
          value=""
          placeholder="Choose where you are"
          options={homes.map((h) => ({ value: h.id, label: h.name }))}
          onChange={(e) => {
            setHome(e.target.value || null);
            router.refresh();
          }}
        />
      </div>
    ) : null;
  return (
    <Link
      href={on ? "/reading/next" : "/reading/next?hand=1"}
      aria-pressed={on}
      className={`inline-flex h-8 items-center rounded-sm border px-3 text-sm transition-colors pointer-coarse:h-11 ${
        on ? "border-accent-rose/10 bg-accent-plum/80 text-fg-primary" : "border-glass-border text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"
      }`}
      data-queue-hand=""
    >
      At hand in {home.name}
    </Link>
  );
}
