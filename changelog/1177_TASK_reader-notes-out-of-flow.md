# Keep semantic notes out of the chapter flow

SLN-1488: both reader presentation paths hide the literal epub:type attributes used by HTML srcdoc sections, in addition to the original XHTML namespaced selectors. The HTML selectors use a separate rule so an unsupported namespace cannot invalidate them. Note content remains available for the existing popup extraction.

Validation pending: regression tests, full suite and Chromium/Firefox/WebKit srcdoc and note-popup checks. No schema, catalogue or stored book changes.
