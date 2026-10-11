"use client";

import { BookOpen, ChevronDown } from "lucide-react";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { formatLabel } from "@/lib/ebooks/formats";
import { languageName } from "@/lib/utils/language";
import {
  catalogueReadLabel,
  readTarget,
  type EbookAvailability,
} from "@/lib/ebooks/read-target";
import { readerEntryHref } from "@/lib/reader/entry-policy";

const control =
  "inline-flex h-8 items-center justify-center gap-2 rounded-sm border border-glass-border bg-bg-secondary px-3 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11";
const menuItem =
  "dropdown-item py-2 text-sm text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary focus:bg-bg-tertiary focus:text-fg-primary outline-none pointer-coarse:min-h-11";

/** No row/file checks here: availability and Continue are owned by the shared query. */
export function CatalogueReadButton({
  availability,
  originalLanguage,
  returnTo,
}: {
  availability: readonly EbookAvailability[];
  originalLanguage: string | null;
  returnTo?: unknown;
}) {
  const eligible = availability.filter(
    (ebook) => ebook.continue && readerEntryHref(ebook.continue.href, returnTo),
  );
  const target = readTarget(eligible, originalLanguage);
  if (!target?.continue) return null;
  const formats = target.formats.map(formatLabel).join(", ");
  return (
    <div className="inline-flex items-center gap-1" data-catalogue-read>
      <ReaderEntryLink
        readerPath={target.continue.href}
        returnTo={returnTo}
        className={control}
        data-read-button
        data-tooltip={`Read the eBook (${formats})`}
      >
        <BookOpen
          className="h-3.5 w-3.5"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span>{catalogueReadLabel(target.continue)}</span>
      </ReaderEntryLink>
      {eligible.length > 1 && (
        <DropdownMenu
          label="Choose an eBook edition"
          align="start"
          trigger={
            <button className={`${control} w-8 px-0 pointer-coarse:w-11`}>
              <ChevronDown
                className="h-4 w-4"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </button>
          }
        >
          {eligible.map((ebook) => (
            <ReaderEntryLink
              key={ebook.ebookId}
              readerPath={ebook.continue!.href}
              returnTo={returnTo}
              role="menuitem"
              className={menuItem}
            >
              <span className="dropdown-icon" />
              <span className="dropdown-label">
                {languageName(ebook.editionLanguage) ?? "Unknown language"}{" "}
                edition{ebook.editionYear ? `, ${ebook.editionYear}` : ""} ·{" "}
                {ebook.formats.map(formatLabel).join(", ")}
              </span>
            </ReaderEntryLink>
          ))}
          <a
            role="menuitem"
            className={menuItem}
            href={`/ebooks/${target.ebookId}`}
          >
            <span className="dropdown-icon" />
            <span className="dropdown-label">Open the eBook page</span>
          </a>
        </DropdownMenu>
      )}
    </div>
  );
}
