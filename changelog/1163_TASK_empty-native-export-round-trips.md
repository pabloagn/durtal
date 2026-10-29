# Empty exports import back without writes

SLN-1183. Empty JSON lists, recognized zero-row Durtal Parquet exports (current and version 2), and the complete empty Goodreads header now return a successful no-op from the reading import upload. The file picker and drop handler accept those formats. The response creates no import, row or S3 copy; JSON's missing entity metadata is not invented.

Populated JSON/Parquet files remain explicitly refused with CSV/TSV guidance. Malformed files, unknown Parquet provenance, incomplete columns and invalid UTF-8 also remain refusals. Existing non-empty CSV/TSV histories keep their preview workflow.

The previous export fixes already made the empty downloads and commonplace wording consistent. This completes the remaining empty-file round trip. Validation is recorded on the ticket and PR; no schema or live catalogue changes.
