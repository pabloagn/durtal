/**
 * Cover colours for every poster and edition cover stored before SLN-405
 * (`src/lib/color/backfill.ts`). Stored palettes get their colour; images
 * without a palette are read once each. A second run changes nothing new.
 *
 *   node --env-file=.env.local --import tsx scripts/maintenance/backfill-cover-colors.ts --dry-run
 *   node --env-file=.env.local --import tsx scripts/maintenance/backfill-cover-colors.ts
 */
import { backfillCoverColors } from "../../src/lib/color/backfill";

const dryRun = process.argv.includes("--dry-run");
const result = await backfillCoverColors({ dryRun });
console.log(JSON.stringify({ dryRun, ...result }, null, 2));
process.exit(result.posters.failed + result.covers.failed > 0 ? 1 : 0);
