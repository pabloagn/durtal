"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SECTIONS } from "./sections";

/** The settings menu: a column beside the settings, a row above them on small screens. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="md:sticky md:top-6 md:self-start">
      <ul className="flex flex-wrap gap-1 md:flex-col md:gap-0.5">
        {SETTINGS_SECTIONS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-sm border px-2.5 py-1.5 text-sm transition-colors duration-150 pointer-coarse:min-h-11 ${
                  active
                    ? "border-accent-rose/10 bg-accent-plum/80 text-fg-primary"
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
