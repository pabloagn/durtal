import { formatLabel } from "@/lib/ebooks/formats";
import type { EbookDetail } from "@/lib/ebooks/library-queries";
export function EbookPlaces({ ebook }: { ebook: EbookDetail }) {
  if (!ebook.positions.length)
    return <p className="text-sm text-fg-secondary">No saved places yet.</p>;
  return (
    <ul className="divide-y divide-glass-border">
      {ebook.positions.map((place) => {
        const file = ebook.files.find((file) => file.id === place.fileId);
        const percent =
          Math.round(place.locator.totalProgression * 10000) / 100;
        return (
          <li
            key={`${place.deviceId}-${place.fileId}`}
            className="py-3 text-sm"
          >
            <p>
              {place.deviceLabel} · Saved {percent}%
              {place.chapter ? ` · ${place.chapter}` : ""}
            </p>
            <p className="mt-1 text-xs text-fg-secondary">
              {file ? formatLabel(file.format) : "Historical file"} ·{" "}
              {new Date(place.clientUpdatedAt)
                .toISOString()
                .slice(0, 16)
                .replace("T", " ")}{" "}
              UTC
              {file?.status === "replaced"
                ? " · Replaced file; resumes in the current file"
                : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
