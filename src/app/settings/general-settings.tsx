"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Select } from "@/components/ui/select";
import {
  SettingRow,
  SettingsGroup,
  SettingsIntro,
  settingDescriptionId,
} from "@/components/settings/settings-group";
import { updateAppSettings, type AppSettings } from "@/lib/actions/settings";
import { NEW_BOOK_STATUSES } from "@/lib/validations/settings";
import {
  COPY_CONDITION_LABELS,
  COPY_FORMAT_LABELS,
  STATUS_CONFIG,
} from "@/lib/constants/catalogue";
import { LANGUAGES } from "@/lib/constants/languages";
import { CURRENCY_SELECT_OPTIONS } from "@/lib/constants/currencies";
import {
  INSTANCE_CONDITIONS,
  INSTANCE_FORMATS,
  type InstanceCondition,
  type InstanceFormat,
} from "@/lib/types";

interface LocationOption {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
}

const STATUS_OPTIONS = NEW_BOOK_STATUSES.map((status) => ({
  value: status,
  label: STATUS_CONFIG[status].label,
}));
const FORMAT_OPTIONS = INSTANCE_FORMATS.map((format) => ({
  value: format,
  label: COPY_FORMAT_LABELS[format],
}));
const CONDITION_OPTIONS = INSTANCE_CONDITIONS.map((condition) => ({
  value: condition,
  label: COPY_CONDITION_LABELS[condition],
}));

/** A select in a setting row: named by the row, explained by its description. */
function SettingSelect({
  id,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-56">
      <Select
        id={id}
        value={value}
        options={[...options]}
        placeholder={placeholder}
        ariaDescribedby={settingDescriptionId(id)}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/**
 * The app-wide defaults. Each change saves at once; a refused change puts
 * the old value back.
 */
export function GeneralSettings({
  settings: saved,
  locations,
}: {
  settings: AppSettings;
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(saved);
  const [, startTransition] = useTransition();

  function save(change: Partial<AppSettings>, message: string) {
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
        setSettings(result.settings);
        toast.success(message);
        router.refresh();
      } catch {
        setSettings(before);
        toast.error("Could not save the setting. Try again.");
      }
    });
  }

  // Inactive locations are not offered, unless one is the saved default
  const locationOptions = locations
    .filter((location) => location.isActive || location.id === settings.newCopyLocationId)
    .map((location) => ({
      value: location.id,
      label: location.isActive ? location.name : `${location.name} (inactive)`,
    }));
  const locationName = (id: string) =>
    locations.find((location) => location.id === id)?.name ?? "that location";
  const languageName = (code: string) =>
    LANGUAGES.find((language) => language.value === code)?.label ?? code;

  return (
    <>
      <SettingsIntro>
        Defaults for new records. They are saved in the catalogue, so they apply on every
        device. You can still change them for each record.
      </SettingsIntro>

      <SettingsGroup title="New books" description="The add-book wizard and Fast Track start with these.">
        <SettingRow
          id="new-book-status"
          label="Status"
          description="The catalogue status of a new book."
        >
          <SettingSelect
            id="new-book-status"
            value={settings.newBookStatus}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              const status = value as AppSettings["newBookStatus"];
              save({ newBookStatus: status }, `New books start as ${STATUS_CONFIG[status].label}`);
            }}
          />
        </SettingRow>
        <SettingRow
          id="new-book-language"
          label="Language"
          description="For books entered by hand, and when the source gives no language."
        >
          <SettingSelect
            id="new-book-language"
            value={settings.newBookLanguage}
            options={LANGUAGES}
            onChange={(value) =>
              save({ newBookLanguage: value }, `New books start in ${languageName(value)}`)
            }
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="New copies"
        description="The copies step of the wizard and the Add copy dialog start with these."
      >
        <SettingRow
          id="new-copy-location"
          label="Location"
          description="Where a new copy is kept. It also comes first in the location list."
        >
          <SettingSelect
            id="new-copy-location"
            value={settings.newCopyLocationId ?? ""}
            options={locationOptions}
            placeholder="Pick for each copy"
            onChange={(value) =>
              save(
                { newCopyLocationId: value || null },
                value ? `New copies start in ${locationName(value)}` : "New copies start with no location",
              )
            }
          />
        </SettingRow>
        <SettingRow id="new-copy-format" label="Format" description="The format of a new copy.">
          <SettingSelect
            id="new-copy-format"
            value={settings.newCopyFormat ?? ""}
            options={FORMAT_OPTIONS}
            placeholder="None"
            onChange={(value) => {
              const format = (value || null) as InstanceFormat | null;
              save(
                { newCopyFormat: format },
                format ? `New copies start as ${COPY_FORMAT_LABELS[format]}` : "New copies start with no format",
              );
            }}
          />
        </SettingRow>
        <SettingRow
          id="new-copy-condition"
          label="Condition"
          description="The condition of a new copy."
        >
          <SettingSelect
            id="new-copy-condition"
            value={settings.newCopyCondition ?? ""}
            options={CONDITION_OPTIONS}
            placeholder="None"
            onChange={(value) => {
              const condition = (value || null) as InstanceCondition | null;
              save(
                { newCopyCondition: condition },
                condition
                  ? `New copies start as ${COPY_CONDITION_LABELS[condition]}`
                  : "New copies start with no condition",
              );
            }}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Orders">
        <SettingRow
          id="home-currency"
          label="Home currency"
          description="New orders start in this currency. Spending totals show it first."
        >
          <SettingSelect
            id="home-currency"
            value={settings.homeCurrency}
            options={CURRENCY_SELECT_OPTIONS}
            onChange={(value) => save({ homeCurrency: value }, `New orders start in ${value}`)}
          />
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
