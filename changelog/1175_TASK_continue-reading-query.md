# Start Continue reading with books that have a saved place

SLN-1041: materialize the books with an underway saved position before checking file eligibility. A bounded lateral lookup checks files for those books, and only eligible books consume the twelve slots. The e-book page’s independent reads already run in parallel.

No schema or catalogue changes. Regression coverage includes twelve newer saved places with missing files, which must not hide an older readable book.
