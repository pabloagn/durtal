import {
  presentationSchema,
  type ReaderPresentation,
} from "@/lib/validations/reader-preferences";

const COLOUR_FIELDS: ReadonlySet<keyof ReaderPresentation> = new Set([
  "theme",
  "brightness",
  "warmth",
  "dimImages",
]);

/** Adapter integration uses this split: only layout changes enter its owned reflow. */
export function presentationChangeKind(
  previous: ReaderPresentation,
  next: ReaderPresentation,
): "none" | "colour" | "layout" {
  let colour = false;
  // Future schema fields (including SLN-502's) default to layout, never silently vanish.
  for (const name of Object.keys(
    presentationSchema.shape,
  ) as (keyof ReaderPresentation)[]) {
    if (previous[name] === next[name]) continue;
    if (!COLOUR_FIELDS.has(name)) return "layout";
    colour = true;
  }
  return colour ? "colour" : "none";
}
