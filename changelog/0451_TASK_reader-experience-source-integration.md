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

The remaining production source gaps now have implementations: measured PDF
annotation healing and independent decoration overlays; actual PDF sentence
speech enumeration; crop samples and scan classification using page pixels and
operators; theme rendering and fixed-frame size refresh; fixed page/fit/session
zoom controls; comic sort/direction/folder/cache policies; saved Settings defaults
and bounded per-book overrides; retained conflict draft UI and exact auth retry;
and original publisher ink contrast. The shared store implementation and version
remain unchanged. Native computed publisher colours avoid rewriting cross-origin
publisher stylesheets or disabling font-face sheets.

Meaningful test source covers PDF offsets, ambiguity, missing geometry and
cancellation; crop/image classification and raster theme endpoints; overlay group
ownership and viewport adoption; Settings scope races and clear failures;
retained rejection identity and blocked revision retry; and publisher contrast,
original-colour reuse and cancelled owners. These tests have not been executed.
Static import-target resolution and Git whitespace checks were performed; this
is not a substitute for root's executable validation.

Source-only integration is frozen for review. Combined types/lint/tests/build,
native/browser geometry and alignment, live/disposable database, font-transfer,
performance and release gates remain pending. No server control, dependency
installation, database/cloud write or migration application occurred in this
source completion phase. The candidate is not declared ready to ship.
