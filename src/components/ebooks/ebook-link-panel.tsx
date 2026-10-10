import Link from "next/link";
import type { EbookDetail } from "@/lib/ebooks/library-queries";
export function EbookLinkPanel({ ebook }: { ebook: EbookDetail }) {
  if (ebook.matchState === "linked")
    return (
      <p className="text-sm">
        Your copy of{" "}
        {ebook.workSlug ? (
          <Link
            href={`/library/${ebook.workSlug}`}
            className="text-accent-primary"
          >
            {ebook.workTitle ?? ebook.title}
          </Link>
        ) : (
          (ebook.workTitle ?? ebook.title)
        )}
        {[ebook.editionPublisher, ebook.editionYear].filter(Boolean).length
          ? ` (${[ebook.editionPublisher, ebook.editionYear].filter(Boolean).join(", ")})`
          : ""}
        .
      </p>
    );
  if (ebook.matchState === "standalone")
    return <p className="text-sm text-fg-secondary">Kept as an eBook.</p>;
  if (ebook.matchState === "excluded")
    return <p className="text-sm text-fg-secondary">Set aside.</p>;
  return <p className="text-sm text-fg-secondary">Not linked yet.</p>;
}
