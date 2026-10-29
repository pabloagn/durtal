# Explain blocking person credits before Delete

SLN-1246: both person deletion entry points read current non-book credit counts. The dialog offers no Delete while checking or blocked, names the affected films, paintings and perfumes, and accurately explains book-only deletion. Transactional checks still refuse concurrent credits with a readable reason, including object- and variant-level credits. A deleted book-only author leaves the books intact and refreshes their addresses.

Validation and release evidence are recorded in the PR and Linear. No schema or live data changes.
