"use client";

import { KeyCombo } from "@/components/shortcuts/kbd";
import { SettingsGroup, SettingsIntro } from "@/components/settings/settings-group";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts/shortcuts";

/** Every shortcut of the sheet (?), one group per block. */
export function ShortcutList() {
  return (
    <>
      <SettingsIntro>
        Press ? on any page for this list, with that page&apos;s
        own shortcuts at the top.
      </SettingsIntro>
      {SHORTCUT_GROUPS.map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          {group.items.map((item) => (
            // Key caps are one line tall: they sit on the label's first line
            <div
              key={item.label}
              className="flex items-start justify-between gap-4 px-5 py-2.5 text-sm leading-5 text-fg-primary"
            >
              <span className="min-w-0">{item.label}</span>
              <KeyCombo keys={item.keys} then={item.then} />
            </div>
          ))}
        </SettingsGroup>
      ))}
    </>
  );
}
