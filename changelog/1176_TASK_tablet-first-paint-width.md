# Tablet navigation width before hydration

SLN-1499: the server provides the saved desktop and compact navigation widths. CSS selects the compact width at the tablet and short touch-screen breakpoints before the first paint, so hydration does not shift the page from a full sidebar to a rail. Width transitions begin after mount; the existing toggle, resize and separate tablet preference remain available.

Validation: eight sidebar tests; 88 width states and 24 native browser/layout states passed, including the existing collapsed and widened desktop cases. The combined source passed 9,298 tests. Total-CLS acceptance did not pass: cold /library at 780px still measured 0.336 while sidebar and main margin were already 56px from the first painted frame. SLN-1499 remains open for that content reflow; this change completes only the sidebar-width portion.

No schema or catalogue changes.
