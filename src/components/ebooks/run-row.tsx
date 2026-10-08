import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { countsLine, formatDuration, runStateLabel, RUN_KIND_LABEL } from "@/lib/ebooks/run-text";
import type { RunSummary } from "@/lib/ebooks/runs";
import { appTimeZone } from "@/lib/utils/date";

/** 7 Oct 2026, 16:40, in the app's time zone */
export function runTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: appTimeZone(),
  }).format(date);
}

/** How long a run took, or has taken so far */
export function runLength(run: Pick<RunSummary, "startedAt" | "finishedAt" | "updatedAt">) {
  return formatDuration(((run.finishedAt ?? run.updatedAt).getTime() - run.startedAt.getTime()) / 1000);
}

/** Where a run read its files: the machine and the folders; a browser upload has neither */
export function runPlace(run: Pick<RunSummary, "kind" | "host" | "roots">) {
  if (run.kind === "upload") return "Browser upload";
  return [run.host ?? "Unknown machine", ...run.roots].join(" · ");
}

/** One run on /ebooks/runs: what, where, when, how long, its counts and its state */
export function RunRow({ run }: { run: RunSummary }) {
  const state = runStateLabel(run);
  const place = runPlace(run);
  return (
    <li className="flex items-center gap-4 px-4 py-3" data-run-row={run.id}>
      <div className="min-w-0 flex-1">
        <Link href={`/ebooks/runs/${run.id}`} className="block text-sm text-fg-primary transition-colors hover:text-accent-primary touch-hit">
          <span className="lines-1" data-tooltip={place}>
            {RUN_KIND_LABEL[run.kind] ?? run.kind} · {place}
          </span>
        </Link>
        <p className="lines-1 text-xs text-fg-secondary">
          {runTime(run.startedAt)} · {runLength(run)} · {countsLine(run.counts)}
        </p>
      </div>
      <Badge variant={state.tone} className="shrink-0">
        {state.label}
      </Badge>
    </li>
  );
}
