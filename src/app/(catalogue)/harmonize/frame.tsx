import type { ReactNode } from "react";
import {
  GitMerge,
  ImageIcon,
  LoaderCircle,
  ShieldCheck,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { CATEGORY_LABELS } from "@/lib/harmonization/registry";
import type { Category } from "@/lib/harmonization/types";

/*
 * What the Harmonize page and its loading screen both draw, so the loading
 * screen keeps the page's own header and category cards (task 0611).
 */

export const ICONS: Record<Category, LucideIcon> = {
  duplicates: GitMerge,
  artwork: ImageIcon,
  metadata: TextCursorInput,
  integrity: ShieldCheck,
};
export const NOTES: Record<Category, string> = {
  duplicates: "Bring scattered records together",
  artwork: "Complete the visual library",
  metadata: "Give every detail its place",
  integrity: "Keep relationships consistent",
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

/** A busy label keeps its words: its icon turns into a spinner (contract section 8) */
export function IconLabel({
  icon: Icon,
  busy = false,
  children,
}: {
  icon: LucideIcon;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="h-icon-label">
      <CapAligned height={14}>
        {busy ? (
          <LoaderCircle size={14} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
        ) : (
          <Icon size={14} strokeWidth={1.5} />
        )}
      </CapAligned>
      <span>{children}</span>
    </span>
  );
}

/** The eyebrow and the page's title */
export function HarmonizeTitle() {
  return (
    <div>
      <p className="h-eyebrow">
        Library care <span>/</span> Catalogue quality
      </p>
      <h1 className="type-page-title mt-3">
        Harmonize<span className="h-title-dot">.</span>
      </h1>
    </div>
  );
}

/** A category card's label, number and note */
export function StatContent({
  category,
  index,
  count,
}: {
  category: Category;
  index: number;
  count: string;
}) {
  return (
    <>
      <div className="h-stat-label">
        <IconLabel icon={ICONS[category]}>{CATEGORY_LABELS[category]}</IconLabel>
        <span className="h-stat-index">0{index + 1}</span>
      </div>
      <div className="h-stat-number">{count}</div>
      <p>{NOTES[category]}</p>
    </>
  );
}
