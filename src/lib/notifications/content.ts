import { isValidElement } from "react";

export type NotificationLink = { href: string; label: string };

/** Keep only app-local links when restoring browser-owned history. */
export function localNotificationLink(value: unknown): NotificationLink | undefined {
  if (!value || typeof value !== "object") return;
  const { href, label } = value as Record<string, unknown>;
  if (typeof href !== "string" || typeof label !== "string" || !label.trim() ||
      !href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020]/u.test(href)) return;
  const url = new URL(href, "https://durtal.invalid");
  if (url.origin !== "https://durtal.invalid") return;
  return { href: url.pathname + url.search + url.hash, label };
}

/** Read renderable text without invoking components or storing React objects. */
export function notificationContent(value: unknown): { text: string; link?: NotificationLink } {
  if (typeof value === "string" || typeof value === "number") return { text: String(value) };
  if (Array.isArray(value)) {
    const parts = value.map(notificationContent);
    return { text: parts.map((part) => part.text).join(""), link: parts.find((part) => part.link)?.link };
  }
  if (isValidElement<{ children?: unknown; href?: unknown }>(value)) {
    const content = notificationContent(value.props.children);
    return { ...content, link: localNotificationLink({ href: value.props.href, label: content.text }) ?? content.link };
  }
  return { text: "" };
}
