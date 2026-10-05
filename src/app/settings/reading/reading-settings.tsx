"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Select } from "@/components/ui/select";
import { SettingRow, SettingsGroup, SettingsIntro, settingDescriptionId } from "@/components/settings/settings-group";
import { updateAppSettings, type AppSettings } from "@/lib/actions/settings";
import { GoalDialogButton } from "@/components/reading/goal-dialog-button";

type ReadingValues = Pick<AppSettings, "readingDayStartHour" | "readingWeekStart" | "readingTimerCheckMinutes" | "readingRhythmDays">;

const HOURS = [0, 1, 2, 3, 4, 5, 6].map((h) => ({ value: String(h), label: h === 0 ? "Midnight" : `0${h}:00` }));
const WEEK_STARTS = [
  { value: "1", label: "Monday" },
  { value: "7", label: "Sunday" },
];
const RHYTHM = [
  { value: "", label: "Off" },
  ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: `${d} ${d === 1 ? "day" : "days"} a week` })),
];
const CHECKS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => ({
  value: String(m),
  label: m < 60 ? `${m} minutes` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} ${m === 60 ? "hour" : "hours"}`,
}));

function SettingSelect({ id, value, options, onChange }: { id: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="w-56">
      <Select id={id} value={value} options={options} ariaDescribedby={settingDescriptionId(id)} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/** Reading settings (SLN-451): the reading day, the week, the rhythm and goals (SLN-455), and the timer's question. Each change saves at once */
export function ReadingSettings({ settings: saved }: { settings: ReadingValues }) {
  const router = useRouter();
  const [settings, setSettings] = useState(saved);
  const [, startTransition] = useTransition();

  function save(change: Partial<ReadingValues>, message: string) {
    const before = settings;
    setSettings({ ...settings, ...change });
    startTransition(async () => {
      try {
        const result = await updateAppSettings(change);
        if (!result.ok) {
          setSettings(before);
          toast.error(result.error);
          return;
        }
        setSettings({
          readingDayStartHour: result.settings.readingDayStartHour,
          readingWeekStart: result.settings.readingWeekStart,
          readingTimerCheckMinutes: result.settings.readingTimerCheckMinutes,
          readingRhythmDays: result.settings.readingRhythmDays,
        });
        toast.success(message);
        router.refresh();
      } catch {
        setSettings(before);
        toast.error("Could not save the setting. Try again.");
      }
    });
  }

  const hourLabel = (h: number) => HOURS[h]?.label ?? `${h}:00`;
  return (
    <>
      <SettingsIntro>How reading days, weeks and the reading timer work. They apply on every device.</SettingsIntro>
      <SettingsGroup title="Days and weeks">
        <SettingRow
          id="reading-day-start-hour"
          label="A reading day ends at"
          description="A session before this hour counts for the day before. Past days stay as they were."
        >
          <SettingSelect
            id="reading-day-start-hour"
            value={String(settings.readingDayStartHour)}
            options={HOURS}
            onChange={(v) => save({ readingDayStartHour: Number(v) }, `A reading day now ends at ${hourLabel(Number(v)).toLowerCase()}`)}
          />
        </SettingRow>
        <SettingRow id="reading-week-start" label="A reading week starts on" description="For the reading rhythm and stats.">
          <SettingSelect
            id="reading-week-start"
            value={String(settings.readingWeekStart)}
            options={WEEK_STARTS}
            onChange={(v) => save({ readingWeekStart: Number(v) as 1 | 7 }, `A reading week now starts on ${v === "7" ? "Sunday" : "Monday"}`)}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Rhythm and goals">
        <SettingRow
          id="reading-rhythm-days"
          label="Days I'd like to read each week"
          description="The Reading page shows the days you read this week. 5 of 7 leaves room for rest days."
        >
          <SettingSelect
            id="reading-rhythm-days"
            value={settings.readingRhythmDays ? String(settings.readingRhythmDays) : ""}
            options={RHYTHM}
            onChange={(v) =>
              save({ readingRhythmDays: v ? Number(v) : null }, v ? `Rhythm set to ${v} ${v === "1" ? "day" : "days"} a week` : "Rhythm turned off")
            }
          />
        </SettingRow>
        <SettingRow id="reading-goals" label="Reading goals" description="Optional yearly goals in books, pages or hours." labelFor={false}>
          <GoalDialogButton />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Timer">
        <SettingRow
          id="reading-timer-check-minutes"
          label="Ask “Still reading?” after"
          description="A timer that runs twice as long asks when you stopped before it is saved."
        >
          <SettingSelect
            id="reading-timer-check-minutes"
            value={String(settings.readingTimerCheckMinutes)}
            options={
              CHECKS.some((c) => c.value === String(settings.readingTimerCheckMinutes))
                ? CHECKS
                : [...CHECKS, { value: String(settings.readingTimerCheckMinutes), label: `${settings.readingTimerCheckMinutes} minutes` }]
            }
            onChange={(v) => save({ readingTimerCheckMinutes: Number(v) }, "Saved the timer's question")}
          />
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
