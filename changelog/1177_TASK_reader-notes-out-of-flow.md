# Keep semantic notes out of the chapter flow

SLN-1488: both reader presentation paths hide the literal epub:type attributes used by HTML srcdoc sections, alongside the original XHTML namespace selectors. Popups keep their note content. Explicit Go to note navigation reveals only the destination before the renderer measures it; returning to the chapter hides it again.

Validation covers both presentation paths, the engine navigation boundary and a generated local EPUB in Chromium, Firefox and WebKit at 1440 and 390, including physical note landing and return. Final isolated-branch tests and deployment evidence are recorded in the PR and Linear.

No schema, catalogue or stored book changes.
