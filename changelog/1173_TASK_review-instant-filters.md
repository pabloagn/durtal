# Review e-books with immediate filters

SLN-1039: review filters apply as they change, use the shared controls and format labels, and offer only languages represented in the review queue. The summary omits zero counts and uses plain words. Malformed or out-of-range page numbers fall back to page one without losing filters; large valid pages remain bounded to a safe PostgreSQL offset and the query clamps to the last page.

No schema or catalogue changes.
