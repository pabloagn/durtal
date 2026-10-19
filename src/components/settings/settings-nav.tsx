"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SECTIONS } from "./sections";

/** The settings menu: a column beside the settings, a row above them on small screens. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    // Sticky beside the settings, and never taller than the screen: held
    // sideways a phone's menu is taller than its 390px, so it scrolls inside.
    // The 4px pad keeps a focused link's outline in view (SLN-1223)
    <nav
      aria-label="Settings"
      className="md:sticky md:top-6 md:-m-1 md:max-h-[calc(100dvh-3rem+0.5rem)] md:self-start md:overflow-y-auto md:overscroll-contain md:p-1"
    >
      <ul className="flex flex-wrap gap-1 pointer-coarse:gap-2 md:flex-col md:gap-0.5">
        {SETTINGS_SECTIONS.map(({ href, label, icon: Icon }) => {
          // A page inside a section (Reading's history recovery) keeps it marked
          const active = pathname === href || (href !== "/settings" && pathname.startsWith(`${href}/`));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-sm border px-2.5 py-1.5 text-sm transition-colors duration-150 pointer-coarse:min-h-11 ${
                  active
                    ? "border-accent-primary/10 bg-selection-bg/80 text-fg-primary"
                    : "border-transparent text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
