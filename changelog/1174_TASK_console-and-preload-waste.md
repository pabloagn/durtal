# Reduce avoidable requests and misleading queue actions

SLN-1438, partial: missing book covers fall back immediately, without automatic retry loops. They use one resized source and no duplicate speculative preload. The unused Cirka Bold face no longer preloads. Suggestions receive explicit queue membership, so an already queued book does not offer Add to Up next, including in the compact menu. The PDF asset version uses the supported default JSON import.

The ticket remains open: a native production WebKit check still observed three requests for a missing cover, above the requested two-request limit. The other changes have regression coverage; the development PDF reader showed no JSON named-export warning. This log does not claim the request-count acceptance passed.

No schema or catalogue changes.
