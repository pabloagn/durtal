import { requireEnabledDomain } from "@/lib/catalogue/domain-gate";

/** Every perfume page answers 404 until the collection opens. */
export default function PerfumesLayout({ children }: { children: React.ReactNode }) {
  requireEnabledDomain("perfume");
  return children;
}
