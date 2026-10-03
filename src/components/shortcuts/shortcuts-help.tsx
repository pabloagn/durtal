"use client";

import { Dialog } from "@/components/ui/dialog";
import { KeyCombo } from "@/components/shortcuts/kbd";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts/shortcuts";

interface PageShortcut {
  key: string;
  label: string;
}

/** The sheet of every keyboard shortcut, with this page's own at the top */
export function ShortcutsHelp({
  open,
  onClose,
  pageShortcuts,
}: {
  open: boolean;
  onClose: () => void;
  pageShortcuts: PageShortcut[];
}) {
  const groups = [
    ...(pageShortcuts.length
      ? [
          {
            title: "This page",
            wide: true,
            items: pageShortcuts.map((s) => ({ keys: [s.key], label: s.label, then: false })),
          },
        ]
      : []),
    ...SHORTCUT_GROUPS,
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      className="max-w-3xl"
      expandable={false}
    >
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title} className={group.wide ? "sm:col-span-2" : ""}>
            <h3 className="mb-2 font-serif text-lg text-fg-secondary">
              {group.title}
            </h3>
            <ul className={group.wide ? "grid gap-x-10 sm:grid-cols-2" : ""}>
              {group.items.map((item) => (
                // Key caps are one line tall: they sit on the label's first line
                <li
                  key={item.label}
                  className="flex items-start justify-between gap-4 border-b border-glass-border py-1.5 text-sm leading-5 text-fg-secondary"
                >
                  <span className="min-w-0">{item.label}</span>
                  <KeyCombo keys={item.keys} then={item.then} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
