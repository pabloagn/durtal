import { getAppSettings } from "@/lib/actions/settings";
import { ReadingSettings } from "./reading-settings";

export const metadata = { title: "Reading settings" };

export default async function ReadingSettingsPage() {
  const settings = await getAppSettings();
  return (
    <ReadingSettings
      settings={{
        readingDayStartHour: settings.readingDayStartHour,
        readingWeekStart: settings.readingWeekStart,
        readingTimerCheckMinutes: settings.readingTimerCheckMinutes,
        readingRhythmDays: settings.readingRhythmDays,
        readingSuggestHideAnathema: settings.readingSuggestHideAnathema,
      }}
    />
  );
}
