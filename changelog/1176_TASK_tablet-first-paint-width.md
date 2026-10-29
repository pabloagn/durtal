# Tablet navigation width before hydration

SLN-1499: the server provides the saved desktop and compact navigation widths. CSS selects the compact width at the tablet and short touch-screen breakpoints before the first paint, so hydration does not shift the page from a full sidebar to a rail. Width transitions begin after mount; the existing toggle, resize and separate tablet preference remain available.

Validation pending: regression tests, cold/warm layout-shift measurements, existing desktop widths and alignment checks. No schema or catalogue changes.
