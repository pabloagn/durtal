export interface HuntAssessment {
  isRare?: boolean;
  huntAssessedOn?: string | null;
}

/** Calendar date in the browser's timezone, without conversion to UTC. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
