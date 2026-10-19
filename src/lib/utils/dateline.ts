/** "Wednesday 15 October 2026" in a time zone, or the runtime's own when none is given */
export function formatDateline(at: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone })
    .format(at)
    .replace(",", "");
}
