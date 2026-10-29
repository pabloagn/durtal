# Correct original book metadata through the API

SLN-598, SLN-602 and SLN-595 already have book and English-edition records. Their original-language/year fields incorrectly copy the English editions. The authenticated work PATCH now accepts original language and year; the authenticated edition PATCH accepts publication year. Each uses the existing update action, validation and history. Unrelated personal fields and edition relationships remain unchanged; unknown fields still fail.

Tests cover preserving English editions and personal fields, invalid language/year input, clearing an unknown original year, and publication-year correction. No migration or new ingestion. Live corrections are separately recorded on the three tickets after verification.
