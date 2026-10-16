# Enrichment assertion scope, contract 1 — SLN-970

## Gap and additive mapping

Existing claims already own the value, vocabulary revision, evidence, decision,
run and audit history. Existing Work, Edition, identifiers and source records
remain the catalogue and provenance authorities. A Work/Edition pair alone
does not identify a translation, an anthology component or a baseline text.

Add nullable `scope` and `assessment` JSON to `enrichment_claims`. Null denotes
the historical contract; it does **not** certify a canonical baseline. No
historical row is relabelled, seeded, merged or applied by this migration.
Existing accepted owner corrections and IDs stay intact.

`scope` version 1 identifies Work baseline, text, component or publication;
the existing `edition_id` links a known publication when relevant. It records
the reviewed baseline/text key, language(s), realization kind, component key
and structural role, and assertion relation. Keys reuse authority identifiers
or text fingerprints; they do not create parallel catalogue entities. Unknown
identity retains an explicit source-record anchor and cannot be merged with an
unidentified record from another source. ISBN identifies a publication, not
the original text or language. Integral/independent/augmenting/parallel parts
remain distinct.

`assessment` separately records knowledge, coverage, evidence basis and its
justification. Review decisions remain proposed/accepted/rejected/superseded.
No candidate means unassessed, not a fabricated negative value. Established
absence requires documented complete examination; partial or disputed evidence
is never treated as a negative label. Source and excerpt provenance remain in
`source_records` and `claim_evidence`.

## Boundaries

- Scope and relation participate in deduplication, conflict comparison and
  immutable claim identity. A topic mention cannot merge with a theme.
- Different translations, editions, components or unresolved source identities
  cannot contribute to one unrestricted claim. No automatic inheritance.
- Newly extracted literary claims default to the identified source text, or
  an unresolved source-local text. A whole-document response cannot identify
  individual anthology pieces or certify a Work baseline by itself.
- The existing application/inbox path supports the historical contract only.
  Scoped assertions remain review proposals and cannot be applied by a user,
  a rule or raw database updates. Scope-aware review/application is a later
  explicitly tested release, not implied by this foundation.
- Full books remain local. This change adds neither a file reader nor an
  external full-text/model transfer path.

## Regression cases

The Kindly Ones: French 2006 Work baseline and English 2010 publication are
different claims. Same-ISBN pagination disagreements are genuine candidates
for comparison; pages from different publications are not conflicts.
Labyrinths: the English 1962 editorial selection is not an invented Spanish
original. Spanish source works, English translations, individual stories,
prefaces and an augmented edition retain separate scopes and contributors.
Conjunctions cannot combine first-person narration of one story with fantasy
in another. The World of Yesterday's unidentified English translation remains
unresolved; no current reference product is silently assigned.

## Migration review and rollback

0089 is generated against the current 0088 journal and reviewed before any
deployment. It adds nullable metadata, scoped uniqueness and guards; no live
migration is authorized. Tests run only on disposable databases. Rollback must
first export/preserve new scoped proposals and verify no scoped rows remain;
only then restore the old index/guards and remove the columns. Refuse rollback
while scoped rows exist. Do not flatten scoped rows into legacy claims or
delete them to make rollback pass.
