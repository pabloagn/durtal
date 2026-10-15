import { ReadingPending } from "./reading-pending";

/**
 * Every reading tab while it loads (SLN-749). The tabs sit in a route group so
 * a year in review and an import, whose pages answer 404 for a missing one,
 * stay outside this loading screen (SLN-546).
 */
export default function ReadingLoading() {
  return <ReadingPending />;
}
