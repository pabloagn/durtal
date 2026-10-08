import { formatLabel } from "@/lib/ebooks/formats";
import { formatBytes } from "@/lib/ebooks/run-text";
import type { RunItem } from "@/lib/ebooks/runs";

const OUTCOME_WORDS: Record<string, string> = {
  new_ebook: "New eBook",
  new_format: "Format added",
  replaced_file: "Replaced an older file of this eBook",
  already_stored: "Already stored",
  duplicate_in_run: "Duplicate",
  quarantined: "Quarantined",
  ignored: "Ignored",
  changed_since_plan: "Changed since the plan",
};

const STATE_WORDS: Record<string, string> = {
  pending: "Waiting",
  stored: "Stored; its rows are next",
  registered: "Registered",
};

/** A path under one of the run's folders, from that folder; else the whole path */
export function shortPath(path: string, roots: string[]) {
  for (const root of roots) {
    const base = root.endsWith("/") ? root : `${root}/`;
    if (path.startsWith(base)) return path.slice(base.length);
  }
  return path;
}

/** The second line: the outcome or the reason, then the e-book */
function detail(item: RunItem, roots: string[]) {
  const reason = item.state === "failed" ? (item.lastError ?? item.reason ?? "Failed") : item.reason;
  const said = item.state !== "done" && item.state !== "failed" && !item.outcome ? STATE_WORDS[item.state] : null;
  const what = said ?? (reason && item.outcome !== "duplicate_in_run" ? reason : null) ?? (item.outcome ? OUTCOME_WORDS[item.outcome] : null);
  const duplicate = item.outcome === "duplicate_in_run" && item.reason?.startsWith("Same bytes as ") ? `Same bytes as ${shortPath(item.reason.slice(14), roots)}` : null;
  return [duplicate ?? what, item.drm ? `DRM: ${item.drm}` : null, item.ebookTitle].filter(Boolean).join(" · ");
}

/**
 * One file a run considered: its path from the run's folder (the full path
 * on hover), format and size, then what happened to it. Its e-book is named;
 * the e-book page that it will link to comes with the e-book library.
 */
export function RunItemRow({ item, roots }: { item: RunItem; roots: string[] }) {
  return (
    <li className="px-4 py-3" data-run-item={item.id}>
      <div className="flex items-start gap-4 text-sm">
        <p className="lines-1 min-w-0 flex-1 text-fg-primary" data-tooltip={item.path}>
          {shortPath(item.path, roots)}
        </p>
        <p className="shrink-0 tabular-nums text-fg-secondary">
          {item.format ? `${formatLabel(item.format)} · ` : ""}
          {formatBytes(item.sizeBytes)}
        </p>
      </div>
      <p className="lines-1 text-xs text-fg-secondary">{detail(item, roots) || " "}</p>
    </li>
  );
}
