"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import {
  SettingRow,
  SettingsGroup,
  SettingsIntro,
  settingDescriptionId,
} from "@/components/settings/settings-group";
import { clearPreferences, usePreference } from "@/lib/hooks/use-preference";
import { useSidebarPreference } from "@/lib/hooks/use-sidebar-preference";
import {
  GRID_SIZES,
  LIST_PREFERENCES,
  READER_SETTINGS_KEY,
  SIDEBAR,
  VIEW_MODE_LABELS,
  type ListPreference,
} from "@/lib/preferences";
import { DEFAULT_PER_PAGE, PAGE_SIZES } from "@/lib/utils/pagination";
import {
  perPageCookieName,
  preferenceCookieNames,
} from "@/lib/utils/preference-cookies";

const LISTS: ListPreference[] = Object.values(LIST_PREFERENCES);
const GRID_OPTIONS = GRID_SIZES.map((size) => ({
  value: String(size),
  label: `${size} per row`,
}));
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((size) => ({
  value: String(size),
  label: `${size} per page`,
}));
/** The list table's columns: the list, its view, its grid size, its page size */
const LIST_COLUMNS =
  "@min-[640px]:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_8.5rem]";

function SidebarSetting() {
  const { width, toggle } = useSidebarPreference();
  const collapsed = width === SIDEBAR.collapsed;
  return (
    <SettingRow
      id="sidebar-collapsed"
      label="Collapsed sidebar"
      description="Show only the icons. The sidebar toggle, dragging its edge or double-clicking it changes this too."
      controlHeight={20}
    >
      <Switch
        id="sidebar-collapsed"
        checked={collapsed}
        aria-describedby={settingDescriptionId("sidebar-collapsed")}
        onCheckedChange={toggle}
      />
    </SettingRow>
  );
}

function ViewSelect({
  list,
  view,
}: {
  list: ListPreference;
  view: NonNullable<ListPreference["view"]>;
}) {
  const [stored, setStored] = usePreference<ViewMode>(view.key, view.fallback);
  return (
    <Select
      ariaLabel={`${list.label}: view`}
      value={view.modes.includes(stored) ? stored : view.fallback}
      options={view.modes.map((mode) => ({
        value: mode,
        label: VIEW_MODE_LABELS[mode],
      }))}
      onChange={(event) => setStored(event.target.value as ViewMode)}
    />
  );
}

function GridSelect({
  list,
  grid,
}: {
  list: ListPreference;
  grid: NonNullable<ListPreference["grid"]>;
}) {
  const [stored, setStored] = usePreference<number>(grid.key, grid.fallback);
  const size = GRID_SIZES.some((n) => n === stored) ? stored : grid.fallback;
  return (
    <Select
      ariaLabel={`${list.label}: cards per row`}
      value={String(size)}
      options={GRID_OPTIONS}
      onChange={(event) => setStored(Number(event.target.value))}
    />
  );
}

function PageSizeSelect({ list }: { list: ListPreference }) {
  // The list page reads this cookie before it renders (src/proxy.ts)
  const [stored, setStored] = usePreference<number>(
    perPageCookieName(list.path),
    DEFAULT_PER_PAGE,
  );
  const size = PAGE_SIZES.some((n) => n === stored) ? stored : DEFAULT_PER_PAGE;
  return (
    <Select
      ariaLabel={`${list.label}: items per page`}
      value={String(size)}
      options={PAGE_SIZE_OPTIONS}
      onChange={(event) => setStored(Number(event.target.value))}
    />
  );
}

/** A list's name, then its view, grid size and page size; a dash where the list has none. */
function ListRow({ list }: { list: ListPreference }) {
  const none = (
    <span className="hidden text-sm text-fg-secondary @min-[640px]:block">
      <span aria-hidden>—</span>
      <span className="sr-only">None</span>
    </span>
  );
  return (
    <div
      className={`grid grid-cols-2 items-center gap-3 px-5 py-3 ${LIST_COLUMNS} @min-[640px]:gap-4`}
    >
      <p className="col-span-2 text-sm text-fg-primary @min-[640px]:col-span-1">
        {list.label}
      </p>
      {list.view ? <ViewSelect list={list} view={list.view} /> : none}
      {list.grid ? <GridSelect list={list} grid={list.grid} /> : none}
      <PageSizeSelect list={list} />
    </div>
  );
}

function ResetSetting() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  function reset() {
    // Every display preference but the reader's, which has its own reset
    clearPreferences(
      preferenceCookieNames().filter((name) => name !== READER_SETTINGS_KEY),
    );
    setConfirming(false);
    toast.success("Display settings reset");
    router.refresh();
  }

  return (
    <>
      <SettingRow
        id="display-reset"
        label="Reset display settings"
        description="Every list goes back to its default view, grid size, columns and page size, and the sidebar opens."
      >
        <Button
          id="display-reset"
          aria-describedby={settingDescriptionId("display-reset")}
          onClick={() => setConfirming(true)}
        >
          Reset
        </Button>
      </SettingRow>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Reset display settings?"
        className="max-w-lg"
        expandable={false}
      >
        <p className="text-sm text-fg-secondary">
          This browser forgets the view, grid size, columns and page size of
          every list, and the sidebar width. The catalogue does not change.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={reset}>
            Reset
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** Display preferences: cookies in this browser, the same ones the lists and the sidebar change. */
export function DisplaySettings() {
  return (
    <>
      <SettingsIntro>
        How the sidebar and the lists look. These are saved in this browser
        only; another browser keeps its own.
      </SettingsIntro>

      <SettingsGroup title="Sidebar">
        <SidebarSetting />
      </SettingsGroup>

      <SettingsGroup
        title="Lists"
        description="Each list also changes these from its own toolbar and page controls."
      >
        <div className="@container divide-y divide-glass-border">
          <div
            aria-hidden
            className={`hidden gap-4 px-5 py-2.5 type-caption @min-[640px]:grid ${LIST_COLUMNS}`}
          >
            <span>List</span>
            <span>View</span>
            <span>Grid size</span>
            <span>Page size</span>
          </div>
          {LISTS.map((list) => (
            <ListRow key={list.path} list={list} />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Reset">
        <ResetSetting />
      </SettingsGroup>
    </>
  );
}
