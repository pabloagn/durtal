# Remove the unused font preload and misleading queue actions

SLN-1438, partial: the unused Cirka Bold face no longer preloads. Suggestions receive explicit queue membership, so an already queued book does not offer Add to Up next, including in the compact menu. The PDF asset version uses the supported default JSON import.

The missing-cover request-count requirement remains unresolved. Cover rendering is unchanged by this release; the attempted image-loading changes were removed before landing because the native checks did not meet the acceptance criteria. SLN-1438 remains open.

No schema or catalogue changes.
