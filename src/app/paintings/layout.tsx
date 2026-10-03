import { requireEnabledDomain } from "@/lib/catalogue/domain-gate";

/** Every painting page answers 404 until the collection opens. */
export default function PaintingsLayout({ children }: { children: React.ReactNode }) {
  requireEnabledDomain("painting");
  return children;
}
