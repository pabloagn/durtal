"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Library,
  Users,
  Layers,
  MapPin,
  FolderOpen,
  Tag,
  BookOpen,
  Settings,
  Search,
  Archive,
  Route,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: BookOpen },
  { href: "/library", label: "Library", icon: Library },
  { href: "/authors", label: "Authors", icon: Users },
  { href: "/series", label: "Series", icon: Layers },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/provenance", label: "Provenance", icon: Route },
  { href: "/locations", label: "Locations", icon: Archive },
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
    <aside className="fixed left-0 top-0 z-40 flex h-dvh w-56 flex-col border-r border-glass-border bg-bg-secondary/80 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex h-14 items-center px-5">
        <Link
          href="/"
          className="font-serif text-2xl tracking-tight text-fg-primary"
        >
          Durtal
        </Link>
      </div>

      {/* Search trigger */}
      <div className="px-3 pb-2">
        <button
          onClick={onCommandPalette}
          className="flex w-full items-center gap-2 rounded-sm border border-glass-border bg-bg-primary/50 px-3 py-1.5 text-sm text-fg-muted transition-all duration-150 hover:border-fg-muted/20 hover:text-fg-secondary"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search...</span>
          <kbd className="ml-auto font-mono text-micro text-fg-muted">
            <span className="text-nano">&#8984;</span>K
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
                  className={`flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm transition-all duration-150 ${
                    isActive
                      ? "bg-accent-plum/80 text-fg-primary border border-accent-rose/10"
                      : "text-fg-secondary border border-transparent hover:bg-bg-tertiary/50 hover:text-fg-primary"
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
      <div className="border-t border-glass-border px-5 py-3">
        <p className="font-mono text-micro text-fg-muted">
          catalogue &middot; index &middot; archive
        </p>
      </div>
    </aside>
  );
}
