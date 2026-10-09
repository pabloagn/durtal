"use client";
import { Dialog } from "@/components/ui/dialog";
import { useReaderShortcutList } from "./bridge";
export function ShortcutSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const shortcuts = useReaderShortcutList();
  const groups = [...new Set(shortcuts.map((item) => item.group))];
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
            <dl className="space-y-2">
              {shortcuts
                .filter((item) => item.group === group)
                .map((item, at) => (
                  <div
                    key={item.key + at}
                    className="flex justify-between gap-4 text-sm"
                  >
                    <dt>
                      {item.label}
                      {item.context === "selection" && (
                        <span className="text-fg-muted"> · with selection</span>
                      )}
                    </dt>
                    <dd className="shrink-0">
                      <kbd className="rounded-sm border border-border-primary px-2 py-0.5 font-sans text-xs">
                        {item.key}
                      </kbd>
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
