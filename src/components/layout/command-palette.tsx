"use client";

import { useEffect, useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Library,
  Users,
  MapPin,
  FolderOpen,
  Plus,
  Settings,
  BookOpen,
  Search,
  Tag,
} from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NAVIGATION_ITEMS = [
  { label: "Dashboard", href: "/", icon: BookOpen, group: "Navigate" },
  { label: "Library", href: "/library", icon: Library, group: "Navigate" },
  { label: "Authors", href: "/authors", icon: Users, group: "Navigate" },
  { label: "Locations", href: "/locations", icon: MapPin, group: "Navigate" },
  {
    label: "Collections",
    href: "/collections",
    icon: FolderOpen,
    group: "Navigate",
  },
  { label: "Tags", href: "/tags", icon: Tag, group: "Navigate" },
  { label: "Settings", href: "/settings", icon: Settings, group: "Navigate" },
];

const ACTION_ITEMS = [
  { label: "Add new book", href: "/library/new", icon: Plus, group: "Actions" },
  {
    label: "Import books",
    href: "/library/import",
    icon: Library,
    group: "Actions",
  },
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");

  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false);
      startTransition(() => {
        router.push(href);
      });
    },
    [router, onOpenChange],
  );

  // Reset query when closing
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-bg-primary/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Palette */}
      <div className="absolute left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2">
        <Command
          className="overflow-hidden rounded-sm border border-bg-tertiary bg-bg-secondary shadow-2xl"
          shouldFilter={true}
          value={query}
          onValueChange={setQuery}
        >
          <div className="flex items-center border-b border-bg-tertiary px-4">
            <Search className="mr-2 h-4 w-4 shrink-0 text-fg-muted" />
            <Command.Input
              placeholder="Search catalogue, navigate, or take an action..."
              className="h-11 w-full bg-transparent text-sm text-fg-primary outline-none placeholder:text-fg-muted"
              autoFocus
            />
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-fg-muted">
              No results found.
            </Command.Empty>

            <Command.Group
              heading="Navigate"
              className="text-xs font-medium text-fg-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {NAVIGATION_ITEMS.map((item) => (
                <Command.Item
                  key={item.href}
                  value={item.label}
                  onSelect={() => navigate(item.href)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-fg-secondary aria-selected:bg-bg-tertiary aria-selected:text-fg-primary"
                >
                  <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Separator className="my-1 h-px bg-bg-tertiary" />

            <Command.Group
              heading="Actions"
              className="text-xs font-medium text-fg-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {ACTION_ITEMS.map((item) => (
                <Command.Item
                  key={item.href}
                  value={item.label}
                  onSelect={() => navigate(item.href)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-fg-secondary aria-selected:bg-bg-tertiary aria-selected:text-fg-primary"
                >
                  <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
