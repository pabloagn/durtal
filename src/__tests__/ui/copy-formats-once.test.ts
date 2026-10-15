import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// SLN-805: an e-book copy headed "eBooks [EPUB] [PDF]" and its eBook row
// named the formats again ("EPUB, PDF · 71.4 KB"). The chips keep them; the
// row keeps the size and the links.
const { stub } = vi.hoisted(() => ({ stub: (name: string) => ({ [name]: () => null }) }));
vi.mock("../../app/(catalogue)/library/[slug]/instance-edit-dialog", () => stub("InstanceEditDialog"));
vi.mock("../../app/(catalogue)/library/[slug]/instance-delete-button", () => stub("InstanceDeleteButton"));
vi.mock("../../app/(catalogue)/library/[slug]/instance-status-button", () => stub("InstanceStatusButton"));
vi.mock("@/components/ebooks/link-ebook-button", () => stub("LinkEbookButton"));
vi.mock("@/components/ebooks/unlink-ebook-button", () => stub("UnlinkEbookButton"));
vi.mock("@/components/reader/reader-entry-link", () => ({ ReaderEntryLink: ({ children }: { children: ReactNode }) => createElement("a", null, children) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));

import { InstanceDetail, type CopyEbook } from "@/app/(catalogue)/library/[slug]/instance-detail";

const instance = {
  id: "c1", editionId: "e1", locationId: "l1", subLocationId: null, format: "ebook", status: "available", condition: null, notes: null,
  hasDustJacket: null, hasSlipcase: null, conditionNotes: null, isSigned: false, signedBy: null, inscription: null,
  isFirstPrinting: false, provenance: null, acquisitionType: null, acquisitionDate: null, acquisitionSource: null,
  acquisitionPrice: null, acquisitionCurrency: null, fileSizeBytes: null, dispositionType: null, dispositionDate: null,
  dispositionTo: null, dispositionPrice: null, dispositionCurrency: null, dispositionNotes: null, lentTo: null, lentDate: null,
  createdAt: new Date("2026-10-15T00:00:00Z"), updatedAt: new Date("2026-10-15T00:00:00Z"),
  location: { id: "l1", name: "eBooks", type: "digital" }, subLocation: null,
} as unknown as Parameters<typeof InstanceDetail>[0]["instance"];
const ebook = (o: Partial<CopyEbook> = {}): CopyEbook => ({
  id: "b1", formats: ["EPUB", "PDF"], sizeBytes: 73_114, readerPath: "/reader/b1", readLabel: null, unavailableReason: null,
  returnTo: "/library/x", marks: { highlights: 0, notes: 0, bookmarks: 0 }, places: 0, ...o,
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("an e-book copy's formats", () => {
  it("are named once, in the chips, with the size in the eBook row", () => {
    const html = text(renderToStaticMarkup(createElement(InstanceDetail, { instance, ebook: ebook() })));
    expect(html.match(/EPUB/g)).toHaveLength(1);
    expect(html.match(/PDF/g)).toHaveLength(1);
    expect(html).toContain("eBook 71.4 KB eBook details Read");
  });

  it("leave the row to its links when the e-book has no file", () => {
    const html = text(renderToStaticMarkup(createElement(InstanceDetail, { instance, ebook: ebook({ sizeBytes: 0, readerPath: null }) })));
    expect(html.match(/EPUB/g)).toHaveLength(1);
    expect(html).toContain("eBook eBook details");
  });
});
