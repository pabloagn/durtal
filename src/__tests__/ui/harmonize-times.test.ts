// @vitest-environment happy-dom
// /harmonize wrote its scan time with the runtime's clock and locale, so the
// server (UTC) and a browser elsewhere wrote different text and hydration
// failed; and it read "09:14 PM". It writes the app's form, in the app's
// time zone, the same in every runtime (SLN-1109).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatDateTime, formatDay } from "@/lib/utils/date";
import type { Scan } from "@/lib/harmonization/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/harmonize" }));
vi.mock("@/lib/actions/harmonization", () => ({
  scanLibrary: vi.fn(), applyFindingFixes: vi.fn(), dismissFinding: vi.fn(), getHarmonizationOperation: vi.fn(),
  getMergePreview: vi.fn(), mergeRecords: vi.fn(), restoreFinding: vi.fn(),
}));
import { HarmonizeWorkspace } from "../../app/(catalogue)/harmonize/workspace";

const scan: Scan = {
  findings: [], total: 0, ready: [], readyTotal: 0,
  counts: { inbox: 0, dismissed: 0, ready: 0, categories: { duplicates: 0, artwork: 0, metadata: 0, integrity: 0 } },
  // 21:14 in Amsterdam
  scannedAt: "2026-10-18T19:14:00.000Z", recordCount: 12345, entityCount: 9, ruleCount: 40, persistenceAvailable: true,
  history: [{ id: "h1", action: "merge", label: "Two books", createdAt: "2026-10-18T22:30:00.000Z" }],
};
const zone = process.env.TZ;
afterEach(() => { process.env.TZ = zone; });
const render = (tz: string) => {
  // The runtime's own zone: the server's, or a browser's
  process.env.TZ = tz;
  return renderToStaticMarkup(createElement(HarmonizeWorkspace, { initialScan: scan, initialError: null, timeZone: "Europe/Amsterdam" }));
};

describe("Harmonize's times (SLN-1109)", () => {
  it("writes the scan time in the app's form and zone, whatever the runtime's zone", () => {
    const server = render("UTC");
    expect(server).toContain("Scanned 18 Oct 2026, 21:14");
    expect(server).toContain("12,345 records");
    for (const browser of ["America/Mexico_City", "Europe/Paris", "Asia/Tokyo"]) expect(render(browser)).toBe(server);
  });

  it("writes days and times the same in every runtime", () => {
    // 00:30 in Amsterdam is the day before in UTC; September is "Sep"
    expect(formatDay("2026-10-18T22:30:00Z", "Europe/Amsterdam")).toBe("19 Oct 2026");
    expect(formatDateTime("2026-10-18T22:30:00Z", "Europe/Amsterdam")).toBe("19 Oct 2026, 00:30");
    expect(formatDateTime("2026-09-03T06:05:00Z", "America/Mexico_City")).toBe("3 Sep 2026, 00:05");
    expect(formatDateTime(new Date("2026-01-01T12:00:00Z"), "UTC")).toBe("1 Jan 2026, 12:00");
  });

  it("formats no time or count with the runtime's locale", () => {
    const source = readFileSync(join(__dirname, "../../app/(catalogue)/harmonize/workspace.tsx"), "utf8");
    expect(source).not.toMatch(/toLocale(Date|Time)String/);
    expect(source).not.toContain("toLocaleString()");
    expect(source).toContain("<time dateTime={item.createdAt}>{formatDay(item.createdAt, timeZone)}</time>");
  });
});
