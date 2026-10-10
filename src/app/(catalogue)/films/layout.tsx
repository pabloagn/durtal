import { requireEnabledDomain } from "@/lib/catalogue/domain-gate";

/** Every film page answers 404 until the collection opens. */
export default function FilmsLayout({ children }: { children: React.ReactNode }) {
  requireEnabledDomain("film");
  return children;
}
