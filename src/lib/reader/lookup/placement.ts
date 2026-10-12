export type LookupRect = { left: number; right: number; top: number; bottom: number };
export function lookupPopoverPosition(anchor: LookupRect | null, avoid: LookupRect | null,
  viewport: { width: number; height: number }, measuredHeight: number, preferBelow = false) {
  const gutter = 16, gap = 8;
  const phone = viewport.width < 768;
  const width = Math.min(phone ? viewport.width - gutter * 2 : 380, viewport.width - gutter * 2);
  const selection = anchor ?? { left: viewport.width / 2, right: viewport.width / 2,
    top: viewport.height / 2, bottom: viewport.height / 2 };
  const left = phone ? gutter : Math.max(gutter, Math.min(viewport.width - width - gutter, selection.left));
  const overlapsX = !!avoid && avoid.right > left && avoid.left < left + width;
  const clampY = (value: number) => Math.max(gutter, Math.min(viewport.height - gutter, value));
  const aboveEnd = clampY(Math.min(selection.top, overlapsX && avoid!.top < selection.top ? avoid!.top : selection.top) - gap);
  const belowStart = clampY(Math.max(selection.bottom, overlapsX && avoid!.bottom > selection.bottom ? avoid!.bottom : selection.bottom) + gap);
  const above = Math.max(0, aboveEnd - gutter);
  const below = Math.max(0, viewport.height - gutter - belowStart);
  const cap = Math.min(viewport.height - gutter * 2,
    phone ? viewport.height / 2 : Math.min(440, viewport.height * .6));
  // Reserve the header, tabs, coarse-pointer controls and useful scrolling body.
  const useful = Math.min(220, cap);
  const farEdgeBelow = (selection.top + selection.bottom) / 2 < viewport.height / 2;
  if (above < useful && below < useful) {
    // A viewport-spanning passage cannot be avoided. Keep the surface usable
    // at the farther edge, with the existing inner body owning scrolling.
    const height = Math.min(cap, Math.max(useful, measuredHeight));
    return { left, top: farEdgeBelow ? viewport.height - gutter - height : gutter,
      width, maxHeight: cap, minHeight: useful };
  }
  if (phone) {
    const bottom = (farEdgeBelow ? below : above) >= useful ? farEdgeBelow : !farEdgeBelow;
    const available = bottom ? below : above;
    const maxHeight = Math.min(cap, available);
    return { left: gutter, top: bottom ? viewport.height - gutter - Math.min(measuredHeight, maxHeight) : gutter,
      width, maxHeight };
  }
  // Prefer the side opposite the toolbar; otherwise use the ticket's 240px threshold.
  const toolbarAbove = overlapsX && avoid!.bottom <= selection.top;
  const toolbarBelow = overlapsX && avoid!.top >= selection.bottom;
  const preferredBelow = preferBelow && below >= Math.min(240, measuredHeight) ? true : toolbarAbove ? below >= Math.min(240, measuredHeight) :
    toolbarBelow ? !(above >= Math.min(240, measuredHeight)) : below >= 240 || below >= above;
  const useBelow = (preferredBelow ? below : above) >= useful ? preferredBelow : !preferredBelow;
  const available = useBelow ? below : above;
  const maxHeight = Math.min(cap, available);
  const height = Math.min(measuredHeight, maxHeight);
  return { left, top: useBelow ? belowStart : aboveEnd - height, width, maxHeight };
}
