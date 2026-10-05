import {
  BookOpenText,
  Database,
  Hourglass,
  Info,
  Keyboard,
  LayoutGrid,
  Plug,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export interface SettingsSection {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** The parts of Settings, in menu order: the settings menu and the command palette list these. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { href: "/settings", label: "General", icon: SlidersHorizontal },
  { href: "/settings/display", label: "Display", icon: LayoutGrid },
  { href: "/settings/reader", label: "Reader", icon: BookOpenText },
  { href: "/settings/reading", label: "Reading", icon: Hourglass },
  { href: "/settings/integrations", label: "Integrations", icon: Plug },
  { href: "/settings/data", label: "Data", icon: Database },
  { href: "/settings/shortcuts", label: "Shortcuts", icon: Keyboard },
  { href: "/settings/about", label: "About", icon: Info },
];
