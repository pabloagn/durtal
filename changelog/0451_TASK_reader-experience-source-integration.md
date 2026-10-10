# Reader experience source integration

Integrates approved reader experience sources in a new isolated managed worktree
from central base 3bb556077907ebfbfbdd8efffd1380f782e4f631. Primary owner files and
the separate central matching writer are protected. All integration commits use
Pablo Aguirre's canonical author and committer identity.

Source order: SLN-553 f4ec27f0; 497 53881449; 501 bcf705a7 and dd93e4e4;
502 d270ef56; 507 f0675eab; 500 384b1f62; 454 1fcdb9f2; 503 3de2d797;
508 cea9eeec; approved 501 hook correction ba403191.

Shared resolutions preserve controller readiness/admission, deployed phone media
bounds, original resume clocks, the durable position queue, one event bus, the
prepared quote-deletion bridge, separate search/history/annotation groups, and
speech cancellation/media/notes lifecycle. The latest preference hook correction
is consumed unchanged; no rule suppression or competing lifecycle fix is added.

Fresh production wiring mounts annotations over the common origin transport;
adds bookmark/highlight/note/panel/Undo controls and owned feature shortcuts;
reads and activates persisted per-device preferences with book/default scopes;
binds approved reflowable CSS/layout policies and real PDF search text producer.
It preserves the approved font assets and metrics. No dependency or asset expansion,
store extension, matching/review consumer, lookup, upload or infrastructure change
is included. Colour-only presentation skips paginator reflow setters.

Validation in this grant is source inspection, Git diff whitespace checks,
commit/tree binding and protected-file hashes only. No tests, lint/typecheck,
build, runtime/browser, cloud or live/native database operations ran. Individual
upstream receipts do not certify this combined source. Migration metadata remains
through 0081; proposals/declarations for 0082–0088 stay explicitly unregistered.
No 0089 migration is introduced.

Real source gaps: measured PDF text is connected to search but PDF search/annotation
decoration drawing, strict PDF mark healing and PDF speech enumeration remain open;
crop/theme and complete fixed/comic controls are not mounted. Broader Settings
book-override listing/UI still uses the legacy screen. Annotation conflicts are
retained by the shared queue, but explicit in-reader conflict resolution UI remains
open. Cross-origin publisher stylesheet transformations stay intact when CSSOM is
unavailable. All combined lifecycle, types, native visual/geometry, database,
performance/font-transfer and release gates remain pending.

The candidate is frozen for integration review, not declared ready to ship.
