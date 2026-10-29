# Keep semantic notes out of the chapter flow

SLN-1488: both reader presentation paths hide the literal epub:type attributes used by HTML srcdoc sections, in addition to the original XHTML namespaced selectors. The HTML selectors use a separate rule so an unsupported namespace cannot invalidate them. Note content remains available for the existing popup extraction. Explicit Go to note navigation temporarily reveals only the destination before measuring its position; a later jump back to the chapter hides it again.

Validation: the source regression tests cover hidden notes, explicit note navigation, and return to chapter. Final combined and browser verification is recorded in the PR and Linear. A generated local EPUB reproduced the duplicated notes in Chromium, Firefox and WebKit at 1440 and 390; the fixed build hid all four note types while retaining the footnote/endnote popups and their Go to note control. All 43 available local route budgets passed. Merge and live verification are tracked in the PR and Linear.

No schema, catalogue or stored book changes.
