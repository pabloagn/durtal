# Match deletion summaries to their actual cascades

SLN-1337: database tests now compare copy and book deletion summaries with the exact rows removed, detached or retained, including reading history, order history, acquisition links, publishers and eBook files/positions/annotations. Credit race tests assert the stale-edit message, and hunt/cover refusals have explicit message checks.

Validation is recorded in the PR and Linear. No production behavior, schema or live-data changes.
