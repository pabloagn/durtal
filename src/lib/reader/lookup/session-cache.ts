import { LOOKUP_LIMITS } from "./policy";
/** Completed render models paint synchronously; this cache never survives the reader session. */
export class LookupSessionCache<T> {
  private items = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  get(key: string): T | null {
    const item = this.items.get(key);
    if (!item) return null;
    this.items.delete(key); this.items.set(key, item);
    return item.value;
  }
  put(key: string, value: T): void {
    const bytes = JSON.stringify(value).length * 2;
    if (bytes > LOOKUP_LIMITS.cacheBytes) return;
    const old = this.items.get(key);
    if (old) { this.bytes -= old.bytes; this.items.delete(key); }
    while (this.items.size >= LOOKUP_LIMITS.cacheEntries || this.bytes + bytes > LOOKUP_LIMITS.cacheBytes) {
      const oldest = this.items.keys().next().value!;
      this.bytes -= this.items.get(oldest)!.bytes; this.items.delete(oldest);
    }
    this.items.set(key, { value, bytes }); this.bytes += bytes;
  }
  clear() { this.items.clear(); this.bytes = 0; }
}
