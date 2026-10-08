# Durtal handover (7 Oct 2026, ~21:40 UTC)

Written by the Claude coordinator for whichever agent picks this project up next. Everything below was true when written; check `git log`, `gh pr list` and the live DB before acting on it.

## 0. Current state in one paragraph
All agent work is **stopped** at the owner's request (credit cost). Nothing is half done. `main` is at **25f314cb** (#167 + #168 merged). The live database (Neon PostgreSQL 16.15) is at migration **0081**. A backup taken just before that migration is in `~/personal/durtal-backups/live-before-0081-20261007-233125.dump` on the owner's Mac. The dev server runs on the Mac at http://localhost:3100 from `~/personal/durtal`.

## 1. Ground rules the owner set (keep them)
- **Live data:** never write to the live DB (imports, deletes, recolours, enrichment runs, AWS setup) without the owner's explicit typed "yes" for that specific action. Schema migrations that ship with a reviewed PR are fine: back up live with `pg_dump` first, migrate, then verify.
- **Packages:** no new npm packages without the owner's typed yes. Already approved: pdfjs-dist (pinned **exactly 6.4.299**), construct-style-sheets-polyfill, @zip.js/zip.js, htmlparser2 and @napi-rs/canvas.
- **Browsers:** headless only (Chrome, Firefox, Playwright WebKit). Never a visible browser, Safari, safaridriver, the iOS Simulator or VoiceOver. For headless Chrome hover checks, pass `--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4`. Escape-key tests must send key code 27.
- **Git:** no git history rewrite, no force push after a PR is open, and no git stash.
- **Design:** the library is about the covers. Book lists and shelves use cover cards, never text-only boxes.
- **Page weight:** /library has a 300 KB limit; person pages have a 400 KB budget.
- **Alignment (CLAUDE.md):** fix every alignment deviation over 0.5 px on any page a PR touches.
- **Talking to the owner:** plain words about what an action does, no ticket nicknames, short messages, lead with the answer. The owner is cost-sensitive: run few agents at a time and no multi-agent orchestration.
- **PR bodies:** start with `<!-- ccr-projects-attribution: {"github_login":"pabloagn"} -->`, then `_Requested by **Joris**_`, and no AI co-author lines.

## 2. Merge procedure that has worked
1. Make a fresh worktree off `origin/main` and merge the PR with `--no-ff`.
2. Run, one at a time: `pnpm install`, typecheck, lint, the unit tests, the DB suite (`python3.12 scripts/qa/test-local.py`), `docker build`, and page weight for UI changes.
3. Fast-forward push to main. If GitHub returns a transient 500, retry with backoff.
4. If the PR has a migration: `pg_dump` live, then `db:migrate`, then a read-only check.
5. Fast-forward `~/personal/durtal` and run `pnpm install` there (the dev server restarts itself on lockfile changes), then update Linear.

The Mac holds a heavy-job lock at `/tmp/durtal-heavy.lck` (`shlock`). It is currently **stale** (its process is gone), so delete it before using the lock. There is also a leftover merge worktree folder, `durtal-merge-bz`, holding #169, #171 and #172 merged together but not pushed. It can be reused or deleted.

## 3. Pull requests
| PR | Ticket | What | State | Next step |
|---|---|---|---|---|
| #169 | SLN-546 | 404 page tests | Reviewed clean, not merged | Merge (train above) |
| #171 | SLN-548 | Touch-target audit script | Reviewed clean, not merged | Merge |
| #172 | SLN-549 | Preview S3 cleanup | Reviewed clean, CI green, not merged | Merge |
| #166 | SLN-516 | QA journeys | Review: clear after one fix | Apply the fix below, re-run gates, push, merge |
| #170 | SLN-545 | Collection toasts | CI green; review half done (static checks clean, browser checks + full suite not run) | Finish review, merge. After landing, check the delete toast on a disposable preview copy only, never live |
| #173 | SLN-547 | UI polish | Not reviewed | Review, merge |
| #174 | SLN-551 | Film lookup: ISO country/language match | Tests pass (3,044/3,044), not reviewed | Review, merge |
| #175 | SLN-492 | E-book reader screens (reader core) | Gates green, not reviewed. Docker build now runs `scripts/vendor-pdfjs.mjs` | Review, merge. Three phone performance rows miss budget; accepted, follow-up is SLN-553 |

**The #166 fix** (scripts/qa/journeys.mjs): give `run(name, steps, undo = [])` a list of `[label, fn]` cleanup pairs. On failure it runs every undo fn (`await fn().catch(() => left.push(label))`) and prints `<name> left behind: ...`. Add undo lists to the collect, books and kinds journeys: delete the collection, then the perfume, film and painting records, then the book and wanted book. For kinds, delete the kept sample and reproduction first. The last step of each journey becomes `for (const [, fn] of undo) await fn();`. Change the header comment to "... at the end, or as soon as a step fails". To test: inject a throwing step and check that table row counts don't grow.

## 4. Migrations and changelog numbers
- Live and main: **0081**. Reserved: **0082** = SLN-495 (e-book matching), **0083** = SLN-501 (reader_preferences table). Next free: **0084** (SLN-497 needs one). Always generate a migration on the exact current main.
- Changelog entries: next free **0411**. Already assigned: 0381-0384 reader stream, 0385-0388 catalogue stream, 0393 #166, 0394 #167, 0395 #170, 0396 #169, 0397 #173, 0398 #171, 0399 #172, 0400 SLN-550, 0401 #174, 0402 SLN-552, 0403 SLN-501, 0404 SLN-502, 0405 SLN-503, 0406 SLN-497, 0407 SLN-475, 0408 SLN-334, 0409 SLN-488, 0410 SLN-333. SLN-463 PR2 holds 0363. Also held: 0276-0279, 0286, 0293-0294 and 0298-0347.
- Linear: the next new ticket is SLN-554.

## 5. Work in progress (unmerged branches)
**E-book epic, SLN-489** (sub-issues SLN-490 to 509; exact texts in Linear):
- **Reader core:** #175 (`claude/reader-stream-qc6s8l`).
- **SLN-493** (cross-device place + tracker bridge): was being built stacked on #175. A work-in-progress branch may or may not have been pushed; check for `claude/*` branches.
- **SLN-501** (typography and themes): branch `claude/reader-typography-themes-zc3fzm`, head 90f55cbf. Only the reader font files are done (public/fonts/reader/v1). Everything else is to do.
- **SLN-503** (search and footnotes): branch `claude/reader-search-footnotes-xfyf38`, head 101e3192. Only `src/lib/reader/search/fold.ts` is written, and it's untested. `footnotes.js` comes from readest/foliate-js at 08db610.
- **SLN-502** (PDFs and comics): not started. The parts that stand alone on #175 are sections 1-2, 6, 7 and 10, the page strip, the zoom menu and pdf-locator.
- **SLN-495** (matching): a work-in-progress branch may exist from the catalogue stream. It needs migration 0082, generated on main 25f314cb or later.
- **SLN-496, 497 and 498:** not started. 497 (/ebooks library) needs indexes on ebooks plus an `ebook_title_sort` function and trigger (migration 0084), and a UNION ALL per match_state so title paging is an index range.
- **Ship order and dependencies:** 493, 499 and 500 come before most reader tickets. 504 to 509 wait on the rest.
- **Owner approvals still pending:** the live e-book bulk load, and AWS setup (S3 bucket + CloudFront via `scripts/aws/ebooks-storage.sh`). Both need the owner's typed yes.

**Small tickets** (ready, all no-migration unless noted):
- SLN-550 touch targets on 5 routes.
- SLN-552 audit fixes; earlier work was lost, so restart it. The two harmonize "failures" were false readings: the buttons have a 44 px `::after` touch area. The film "1 digital copy" failure was already fixed by #164.
- SLN-475 edit a reading's start and current position.
- SLN-334 similar books with more signals (weight = 1/size).
- SLN-488 book page loads the whole library to predict one rating. It must keep the daily on/off check.
- SLN-333 rotate covers and portraits (probably one column, so it needs a migration number).
- SLN-553 reader within phone budgets.
- Linear can close SLN-301, 250 and 432.

## 6. Waiting on the owner (do not start without his yes)
- **Book enrichment epic, SLN-460** (top priority, sub-issues 461-473; plan files kept outside the repo):
  - It needs his approval of vocabulary v1, his list of which test books are unread, API keys in `.env.local` (`TAVILY_API_KEY`, `ANTHROPIC_API_KEY`, `ENRICHMENT_MONTHLY_CAP_USD=10`), and his yes to the outlet seed.
  - Then it runs a 10-book trial: The Kindly Ones, Fatale, The Torture Garden, The Third Policeman, Chess Story, The Rings of Saturn, Telluria, Spider, Absalom Absalom! and The Hour of the Star.
  - Tags go into the existing taxonomy junction tables.
- **Live data jobs awaiting yes:**
  - SLN-422 recolour.
  - Author enrichment apply (410/411), plus 429/431 and 414.
  - Edition-year works and MARC junk publishers.
  - The SLN-450 spreadsheet import (needs the file path).
  - The Databricks read-only Neon role (SLN-543).
- **Remote branch deletes:** sln-462-enrichment-model, sln-410-author-enrichment-pass-2 and author-enrichment, plus worktree `.claude/worktrees/sln-330`.
- **Also pending:** 7 reader-epic questions (defaults apply), StoryGraph read count, a Places key, a Google Books key, S3 versioning, and the iPhone app (paused). The mentions epic is paused too.
- **SLN-459** (reading tracker acceptance) is blocked on SLN-454 and SLN-450.

## 7. Facts
- Live data: 702 works, 704 editions, 212 owned, 0 e-books. Live has no films; film checks run on a synthetic preview.
- Freshly seeded preview DBs can hit PG JIT on /harmonize; running ANALYZE after seeding fixes it.
