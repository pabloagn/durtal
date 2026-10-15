"use client";
import { Fragment } from "react";
import { Dialog } from "@/components/ui/dialog";
import { KeyCombo } from "@/components/shortcuts/kbd";
import { shortcutRows } from "@/lib/reader/keymap";
import { useReaderShortcutList } from "./bridge";

export function ShortcutSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const rows = shortcutRows(useReaderShortcutList());
  const groups = [...new Set(rows.map((row) => row.group))];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reader shortcuts"
      className="max-w-lg"
      expandable={false}
    >
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group}>
            <h3 className="type-label mb-2">{group}</h3>
            <ul>
              {rows
                .filter((row) => row.group === group)
                .map((row) => (
                  <li
                    key={`${row.context} ${row.label}`}
                    className="flex items-start justify-between gap-4 border-b border-glass-border py-1.5 text-sm leading-5 text-fg-secondary"
                  >
                    <span className="min-w-0">
                      {row.label}
                      {row.context === "selection" && <span> · with selection</span>}
                    </span>
                    <span className="inline-flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {row.keys.map((keys, at) => (
                        <Fragment key={keys.join(" ")}>
                          {at > 0 && <span className="text-micro text-fg-secondary">or</span>}
                          <KeyCombo keys={keys} />
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
