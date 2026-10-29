# Start Continue reading with books that have a saved place

SLN-1041: materialize the books with an underway saved position before checking file eligibility. A bounded lateral lookup checks files for those books, and only eligible books consume the twelve slots. The e-book page’s independent reads already run in parallel.

No schema or catalogue changes. Regression coverage includes twelve newer saved places with missing files, which must not hide an older readable book.

Validation: all three eBook routes passed five of five page-weight runs at 60 and at 6,000 synthetic eBooks. The search variants at 6,000 measured 32–44 ms against 150 ms. The final combined source passed 9,298 tests. Merge and live verification are tracked in the PR and Linear.
