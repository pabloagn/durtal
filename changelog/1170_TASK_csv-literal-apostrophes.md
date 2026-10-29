# Preserve literal apostrophes in spreadsheet round trips

SLN-1368: CSV and TSV exports add one formula guard before a formula prefix, including any literal apostrophes already preceding it. The Durtal importer removes exactly that one guard. Text such as `'-ish` or `'=A1` therefore keeps its authored quote, including after repeated round trips. Exports intended for another application's importer remain unguarded.

Regression coverage includes every guarded prefix, zero through multiple authored quotes, CSV and TSV, and three export/import cycles. No schema or live-data changes.
