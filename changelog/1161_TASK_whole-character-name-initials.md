# Whole-character initials in portraits and the palette

SLN-1428. Monograms and command-palette portraits share one initials helper. It keeps combining marks with their letters and takes the first grapheme instead of a UTF-16 code unit. Canonically equivalent accented names produce the same initials.

Regression tests render Hindi, supplementary-plane, accented and punctuation-containing names in the actual Monogram and palette. No data migration.
