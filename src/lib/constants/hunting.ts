export const HUNT_DIFFICULTIES = ["rare", "difficult_to_hunt"] as const;
export type HuntDifficulty = (typeof HUNT_DIFFICULTIES)[number];
export const HUNT_LABELS: Record<HuntDifficulty, string> = {
  rare: "Rare",
  difficult_to_hunt: "Difficult to Hunt",
};

export interface HuntAssessment {
  huntDifficulty?: HuntDifficulty | null;
  huntAssessedOn?: string | null;
}

/** Calendar date in the browser's timezone, without conversion to UTC. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isHuntDifficulty(value: string): value is HuntDifficulty {
  return HUNT_DIFFICULTIES.some((difficulty) => difficulty === value);
}
