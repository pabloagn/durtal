import type { AnchorHTMLAttributes } from "react";
import { readerEntryHref } from "@/lib/reader/entry-policy";

/** A document link, so every reader entry receives the response's CSP. */
export function ReaderEntryLink({
  readerPath,
  returnTo,
  children,
  ...attributes
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readerPath: string;
  returnTo?: unknown;
}) {
  const href = readerEntryHref(readerPath, returnTo);
  if (!href) return null;
  return (
    <a {...attributes} href={href} data-reader-entry>
      {children}
    </a>
  );
}
