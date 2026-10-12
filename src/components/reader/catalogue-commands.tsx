"use client";
import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { CommandPalette } from "@/components/layout/command-palette";

export function ReaderCatalogueCommands({ open, close }: { open: boolean; close(): void }) {
  const change = (open: boolean) => { if (!open) close(); };
  return <ShortcutsProvider paletteOpen={open} onPaletteOpenChange={change}>
    <CommandPalette open={open} onOpenChange={change} />
  </ShortcutsProvider>;
}
