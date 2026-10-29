# Prove person merge and refusal safety

SLN-1338: integration coverage rejects a stale merge without losing identities or credits; counts and checks every distinct work and edition credit through shared and legacy merges; verifies readable refusal messages; and proves repeated case/accent-folded author creation reuses one identity. Existing duplicate-credit collapse coverage remains separate.

Validation uses disposable local databases. No production behavior, schema or data changes.
