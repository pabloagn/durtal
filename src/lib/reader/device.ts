/**
 * This device, for the reader's places (eBooks sub-issue 3): a random id in
 * the durtal-device cookie, set by src/proxy.ts on the first visit to a
 * reader page, and a label such as "iPhone · Safari" read from the user
 * agent. A place is kept per file and device (ebook_positions).
 */

export const DEVICE_COOKIE = "durtal-device";

/** 400 days, the longest a browser keeps a cookie */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const DEVICE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A device id the proxy could have made: a lowercase uuid */
export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_RE.test(value);
}

const DEVICES: [RegExp, string][] = [
  [/iPhone|iPod/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android.*Mobile/, "Android"],
  [/Android/, "Android"],
  [/CrOS/, "Chromebook"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

// Order matters: every Chromium browser also says Chrome and Safari
const BROWSERS: [RegExp, string][] = [
  [/EdgiOS|EdgA?\//, "Edge"],
  [/OPR\/|OPiOS|Opera/, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/FxiOS|Firefox\//, "Firefox"],
  [/CriOS|Chrome\/|Chromium\//, "Chrome"],
  [/Safari\//, "Safari"],
];

/** "iPhone · Safari", "Mac · Firefox"; "Browser" when the agent says nothing useful */
export function deviceLabelFor(
  userAgent: string | null | undefined,
  touch = false,
): string {
  const ua = userAgent ?? "";
  const device =
    touch && /Macintosh/.test(ua)
      ? "iPad"
      : DEVICES.find(([re]) => re.test(ua))?.[1];
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  if (device && browser) return `${device} · ${browser}`;
  return device ?? browser ?? "Browser";
}

/** A bounded display-only hint travels with fetch and beacon; never a device identifier. */
export function positionUrl(
  ebookId: string,
  agent: { userAgent: string; maxTouchPoints: number },
): string {
  const touch = /Macintosh/.test(agent.userAgent) && agent.maxTouchPoints > 1;
  return `/api/reader/${ebookId}/position${touch ? "?touch=1" : ""}`;
}
