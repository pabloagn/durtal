import { ReadingPending } from "@/components/reading/reading-pending";

/** While the page loads, its header with the reading tabs (SLN-815); the layout has checked it exists */
export default function ImportPreviewLoading() {
  return <ReadingPending />;
}
