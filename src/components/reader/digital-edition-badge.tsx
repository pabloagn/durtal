import { BookOpen } from "lucide-react";

/**
 * Small badge overlaid on book cards to indicate a digital
 * edition is available in the Calibre library.
 */
export function DigitalEditionBadge() {
  return (
    <div
      className="flex items-center justify-center rounded-[2px] border border-white/15 bg-black/50 backdrop-blur-md h-4 w-4 @[220px]:h-5 @[220px]:w-5"
      title="Digital edition available"
    >
      <BookOpen
        className="h-2.5 w-2.5 @[220px]:h-3 @[220px]:w-3 text-accent-blue"
        strokeWidth={1.5}
      />
    </div>
  );
}
