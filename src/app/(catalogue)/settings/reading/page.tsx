import { hasReadingGoals } from "@/lib/actions/reading-goals";
import { getAppSettings } from "@/lib/actions/settings";
import { ReadingSettings } from "./reading-settings";

export const metadata = { title: "Reading settings" };

export default async function ReadingSettingsPage() {
  const [settings, hasGoals] = await Promise.all([getAppSettings(), hasReadingGoals()]);
  return (
    <ReadingSettings
      hasGoals={hasGoals}
      settings={{
        readingDayStartHour: settings.readingDayStartHour,
        readingWeekStart: settings.readingWeekStart,
        readingTimerCheckMinutes: settings.readingTimerCheckMinutes,
        readingRhythmDays: settings.readingRhythmDays,
        readingSuggestHideAnathema: settings.readingSuggestHideAnathema,
        readingAutoTrackEbooks: settings.readingAutoTrackEbooks,
      }}
    />
  );
}
