import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";

/** What a settings page holds and where it is saved: the line above its groups. */
export function SettingsIntro({ children }: { children: React.ReactNode }) {
  return <p className="mb-8 text-sm text-fg-secondary">{children}</p>;
}

/**
 * A titled block of settings: a section heading, then one panel with a row
 * per setting. An action (a small button, 28px) sits on the title's
 * cap-height center; give a group with an action no description.
 */
export function SettingsGroup({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <SectionHeading
        title={title}
        description={description}
        action={
          action && (
            <CapAlignedControls height={28} className="type-section-title">
              {action}
            </CapAlignedControls>
          )
        }
      />
      <div className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
        {children}
      </div>
    </section>
  );
}

/** The id of a setting's label: give it to a control that a `<label>` cannot name (a radio group). */
export const settingLabelId = (id: string) => `${id}-label`;
/** The id of a setting's description: the control's `aria-describedby`. */
export const settingDescriptionId = (id: string) => `${id}-description`;

/**
 * One setting: its name and what it does on the left, its control on the
 * right. The control sits on the cap-height center of the name's first line
 * (`controlHeight`, 32px for a field). A wide control (`stacked`) goes under
 * the text instead. On small screens the control always goes under it.
 *
 * `id` is the control's id: the name is its `<label>`. For a control that a
 * label cannot name, pass `labelFor={false}` and give the control
 * `aria-labelledby={settingLabelId(id)}`.
 */
export function SettingRow({
  id,
  label,
  description,
  children,
  controlHeight = 32,
  stacked = false,
  labelFor = true,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  controlHeight?: number;
  stacked?: boolean;
  labelFor?: boolean;
}) {
  const Label = labelFor ? "label" : "p";
  const text = (
    <div className="min-w-0">
      <Label
        id={settingLabelId(id)}
        htmlFor={labelFor ? id : undefined}
        className="block text-sm text-fg-primary"
      >
        {label}
      </Label>
      {description && (
        <p id={settingDescriptionId(id)} className="mt-1 text-xs text-fg-secondary">
          {description}
        </p>
      )}
    </div>
  );
  if (stacked) {
    return (
      <div className="px-5 py-4">
        {text}
        <div className="mt-3">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-5 py-4 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      {text}
      <CapAlignedControls height={controlHeight}>{children}</CapAlignedControls>
    </div>
  );
}

/** A fact in a settings panel: a name on the left, its value on the right. */
export function SettingFact({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <p className="text-fg-secondary">{label}</p>
        {description && <p className="mt-1 text-xs text-fg-secondary">{description}</p>}
      </div>
      <div className="min-w-0 text-fg-primary sm:text-right">{children}</div>
    </div>
  );
}
