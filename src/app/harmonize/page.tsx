import { scanLibrary } from "@/lib/actions/harmonization";
import { HarmonizeWorkspace } from "./workspace";
import "./harmonize.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Harmonize · Durtal" };

export default async function HarmonizePage() {
  const result = await scanLibrary();
  return (
    <HarmonizeWorkspace
      initialScan={result.ok ? result.value : null}
      initialError={result.ok ? null : result.error}
    />
  );
}
