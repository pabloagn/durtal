import { getAppSettings } from "@/lib/actions/settings";
import { appTimeZone } from "@/lib/utils/date";
import { readingDay } from "./dates";

/*
 * The reading day on the server (SLN-451): the `reading_day_start_hour`
 * setting, read for every write that sets a day and every page that shows
 * one. Browser code takes the hour from the page data instead.
 */

/** The hour a reading day starts, 0 to 6 */
export async function readingDayStartHour(): Promise<number> {
  return (await getAppSettings()).readingDayStartHour;
}

/** Today's reading day in a zone (the app's by default), with the setting */
export async function readingToday(zone: string = appTimeZone()): Promise<string> {
  return readingDay(new Date(), zone, await readingDayStartHour());
}
