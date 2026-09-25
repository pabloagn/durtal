import { Badge } from "@/components/ui/badge";
import { HUNT_LABELS, type HuntAssessment } from "@/lib/constants/hunting";

export function HuntBadge({ huntDifficulty, huntAssessedOn }: HuntAssessment) {
  if (!huntDifficulty) return null;
  return (
    <Badge variant="gold" className="max-w-full whitespace-normal">
      <span>
        {HUNT_LABELS[huntDifficulty]}
        {huntAssessedOn && (
          <>
            {" "}
            · <time dateTime={huntAssessedOn}>{huntAssessedOn}</time>
          </>
        )}
      </span>
    </Badge>
  );
}
