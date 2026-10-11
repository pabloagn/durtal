import { checkedInteger, UPLOAD_LIMITS } from "./limits";

/** Measure JSON without first allocating its string; refuse cycles/exotic objects. */
export function boundedJsonBytes(value: unknown, maximum = UPLOAD_LIMITS.reportBytes): number {
  checkedInteger(maximum, "JSON byte bound", 1, UPLOAD_LIMITS.reportBytes);
  let bytes = 0; let nodes = 0; const active = new Set<object>();
  const add = (size: number) => { bytes += size; if (bytes > maximum) throw new Error("Inspector JSON exceeds its byte bound"); };
  const string = (text: string) => {
    add(2);
    for (let at = 0; at < text.length; at++) {
      const code = text.charCodeAt(at);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 0xd800 && code <= 0xdbff && at + 1 < text.length && text.charCodeAt(at + 1) >= 0xdc00 && text.charCodeAt(at + 1) <= 0xdfff) { add(4); at++; }
      else if (code >= 0xd800 && code <= 0xdfff) add(6);
      else add(3);
    }
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 32) throw new Error("Inspector JSON structure exceeds its bound");
    if (item === null) { add(4); return; }
    if (typeof item === "string") { string(item); return; }
    if (typeof item === "boolean") { add(item ? 4 : 5); return; }
    if (typeof item === "number" && Number.isFinite(item)) { add(JSON.stringify(item).length); return; }
    if (!item || typeof item !== "object" || active.has(item)) throw new Error("Inspector JSON value is unsupported");
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new Error("Inspector JSON object is unsupported");
    active.add(item); add(2);
    if (Array.isArray(item)) {
      if (item.length > 100_000) throw new Error("Inspector JSON array exceeds its bound");
      for (let index = 0; index < item.length; index++) { if (index) add(1); visit(item[index] === undefined ? null : item[index], depth + 1); }
    } else {
      let first = true;
      for (const [key, child] of Object.entries(item)) {
        if (child === undefined) continue;
        if (!first) add(1); first = false; string(key); add(1); visit(child, depth + 1);
      }
    }
    active.delete(item);
  };
  visit(value, 0); return bytes;
}
