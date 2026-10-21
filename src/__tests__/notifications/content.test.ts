import { createElement, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { localNotificationLink, notificationContent } from "@/lib/notifications/content";

describe("notification content", () => {
  it("preserves a book link and the complete message as plain history data", () => {
    const content = createElement(Fragment, null,
      createElement("a", { href: "/library/agostino" }, "Agostino"), " moved to Delivered");
    expect(notificationContent(content)).toEqual({ text: "Agostino moved to Delivered", link: { href: "/library/agostino", label: "Agostino" } });
  });
  it.each(["https://elsewhere.test", "//elsewhere.test", "/\\elsewhere.test", "javascript:alert(1)"])("refuses an unsafe stored link: %s", (href) => {
    expect(localNotificationLink({ href, label: "Book" })).toBeUndefined();
  });
});
