# Remove avoidable requests and misleading queue actions

SLN-1438: book covers fall back after at most two failed image requests, without a duplicate speculative preload; eager covers still load at high priority. The unused Cirka Bold face no longer preloads. Suggestions receive explicit queue membership, so an already queued book does not offer Add to Up next, including in the compact menu. The PDF asset version uses the supported default JSON import.

No schema or catalogue changes.
