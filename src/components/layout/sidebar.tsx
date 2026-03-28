"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Library,
  Users,
  MapPin,
  FolderOpen,
  Tag,
  BookOpen,
  Settings,
  Search,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: BookOpen },
  { href: "/library", label: "Library", icon: Library },
  { href: "/authors", label: "Authors", icon: Users },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/collections", label: "Collections", icon: FolderOpen },
  { href: "/tags", label: "Tags", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({
  onCommandPalette,
}: {
  onCommandPalette: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-dvh w-56 flex-col border-r border-bg-tertiary bg-bg-secondary">
      {/* Logo */}
      <div className="flex h-14 items-center px-5">
        <Link href="/" className="font-serif text-xl tracking-tight text-fg-primary">
          Durtal
        </Link>
      </div>

      {/* Search trigger */}
      <div className="px-3 pb-2">
        <button
          onClick={onCommandPalette}
          className="flex w-full items-center gap-2 rounded-sm border border-bg-tertiary bg-bg-primary px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-fg-muted hover:text-fg-secondary"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search...</span>
          <kbd className="ml-auto font-mono text-[10px] text-fg-muted">
            <span className="text-[9px]">&#8984;</span>K
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-accent-plum text-fg-primary"
                      : "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-bg-tertiary px-5 py-3">
        <p className="font-mono text-[10px] text-fg-muted">
          catalogue &middot; index &middot; archive
        </p>
      </div>
    </aside>
  );
}
