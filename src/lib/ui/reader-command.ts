import { isMacPlatform } from "@/lib/shortcuts/shortcuts";

export const READER_COMMAND_EVENT = "durtal-reader-command";

/** Also called for keys in the reader's same-origin book documents. */
export function handleReaderCommand(event: KeyboardEvent): boolean {
  const mod = isMacPlatform() ? event.metaKey : event.ctrlKey;
  const otherMod = isMacPlatform() ? event.ctrlKey : event.metaKey;
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !mod || otherMod || event.key.toLowerCase() !== "k") return false;
  event.preventDefault();
  if (!event.repeat) window.dispatchEvent(new Event(READER_COMMAND_EVENT));
  return true;
}
