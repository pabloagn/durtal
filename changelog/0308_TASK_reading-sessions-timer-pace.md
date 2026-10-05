# Task 0308: Reading sessions, timer, pace, reading settings and phone API

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0304 (SLN-447), 0305 (SLN-448)
**Blocks**: Reading tracker steps 8 to 15 (SLN-442)

## Overview

Step 7 of 15 of the reading tracker (SLN-442, sub-issue SLN-451). Time
becomes part of reading. Joris runs one reading timer from his phone or his
desk and stops it from either, adds or fixes a session by hand, sees how long
a book has left and when he will finish it at his own pace, and logs progress
from an iPhone Shortcut. Every estimate says what it is based on. A forgotten
timer is never saved without an end time, and a page is never counted twice.
Migration 0067 adds three `app_settings` columns and two timer columns on
`reading_sessions`.

## Implementation Details

- Migration `0067_reading_sessions_timer.sql`: `app_settings.reading_day_start_hour`
  (0 to 6, default 4), `reading_week_start` (1 or 7, default 1) and
  `reading_timer_check_minutes` (15 to 480, default 90), each with a CHECK;
  `reading_sessions.paused_at` and `paused_seconds` (0 to 86400) with
  `reading_session_paused_check` (only a running timer is paused). The
  migration test reconciles the five columns.
- Reading settings: `/settings/reading` (`src/app/settings/reading/`), after
  Reader in `SETTINGS_SECTIONS` with the Hourglass icon. "A reading day ends
  at" says "Past days stay as they were": a change applies to new sessions
  only. `readingDay(at, timeZone, dayStartHour)` and
  `formatReadingSpan(r, today)` now take every argument; every caller passes
  the setting (`readingDayStartHour()` and `readingToday()` in
  `src/lib/reading/day.ts`). `grep -rn "readingDay(" src` shows no literal hour.
- Timer (`src/lib/reading/timer.ts` pure, `src/lib/reading/timer-service.ts`,
  actions in `src/lib/actions/reading.ts`): `getRunningTimer`, `startTimer`,
  `pauseTimer`, `resumeTimer`, `stopTimer`, `undoStopTimer`, `discardTimer`.
  A stop completes the running row through `recordProgress` with the new
  `timerSessionId`: no fingerprint, a fresh read asserted in the same atomic
  with the row still running, one retry. The timer keeps its start day and
  zone; it starts where the session before it ends, so a page logged by hand
  during the timer counts once. Over 12 hours is refused; past twice the check
  time it needs an end time. A timer stopped elsewhere answers "This timer was
  stopped on another device". Pause, Finish, Abandon and Delete of a reading
  being timed refuse with "Stop or discard the timer for Nadja first", and
  their dialogs offer Stop and Discard.
- Timer UI: `TimerProvider` (loads after mount, on focus and on a visible
  tab; no polling, nothing in the server render), `TimerChip` in the expanded
  sidebar, the rail and the phone bar, `TimerAlerts` (the forgotten-timer
  question with "Stopped at 21:30", "Still reading" and a time field; "Stop it
  and start this one"; the discard confirmation). Stop opens Log progress in
  stop mode ("You read 42 min. Where are you now?") with a 10-second Undo.
  Start from the book page's card, the hub's cards, the palette ("Start timer
  · Nadja", "Stop timer · Nadja") and `R T`.
- Sessions by hand: `addSession` (always `went_back`, in its place in the
  session order; a backdated session never moves the position back),
  `restoreSession` (the Undo of a delete, with the row's id and source),
  `deleteSession` returning the row, and `getReadingSessions`. The Sessions
  list under the current reading loads when opened: date, time in the
  session's zone with its city when it differs, duration, pages, pace (from
  five minutes), edition or format, source icon; the running timer on top
  with no menu; Edit and Delete with Undo. Earlier reads show "12 sessions ·
  9 h 40 min" and the same list. Add a session and Edit session show the
  start as text ("From p. 180, where the session before ended") and warn when
  the end is before it.
- Pace (`src/lib/reading/pace.ts`, pure): pages an hour blended with his
  prior (`(pages + 2 × prior) / (hours + 2)`, the prior by language and
  format, format, everything, else 30), listening speed for audio
  (`(listened + 60) / (advanced + 60)`), time left, and the finish date from
  a 14-day half-life average of pages a day, paused days left out, after
  three sessions on two days, a range when unsteady. `getPaceContext(ids)`
  gives the inputs for a whole page in one query, pages from
  `countedPagesSql`, the running timer left out, numbers as `float8`.
  `readingEstimates` shows "About 6 h 40 min left · Around 18 Oct" with an
  info popover (a native `popover` in glass) on the book page, the hub's cards
  and the dashboard's tiles (server text, the button a client island).
- Phone API (`src/app/api/readings/`, helpers in `src/lib/api/readings.ts`):
  `GET /api/readings/open`, `POST /api/readings/[id]/progress`,
  `POST /api/readings/timer/start`, `POST /api/readings/timer/stop`,
  `POST /api/readings`. Every route checks the token first, GETs included.
  Every answer has a `message` a Shortcut can speak. `tz` sets the session's
  zone and day. `preview-local.py --api-token` gives a preview a random token
  for that run only.
- Docs: 02 (columns and checks), 03 (the chip), 04 (`/settings/reading`, the
  chip, the session list, `R T`, the palette), 05 (the routes, the token on
  every `/api/readings` route, `tz`, status codes, the iPhone Shortcut
  recipe), 06 (the actions, `timerSessionId`, `getPaceContext`, the settings),
  11 (Phone shortcuts: the Authelia rule, and the Mac on :3100).

## Completion Notes

- Migration rehearsal (`preview-local.py --from-dump`, the backup taken
  before 0064 and 0065): 110 tables, 21,560 rows; the one table with
  differences, `works` (24 rows), is 0065's rating type and shows the same on
  main. 0067 changes no existing column. `work-kind-migration.test.ts`
  reconciles the five new columns. I apply 0067 after the merge.
- Tests: `scripts/qa/test-local.py` (every suite, a disposable PostgreSQL 16):
  193 files passed; the migration suite failed in its 0067 block, which read
  the new columns before the step that adds them. Fixed, that suite alone
  passes 7 of 7: 194 files and 2,189 tests in all, none skipped. New: the
  database suites `reading-sessions` (18) and `reading-routes` (9), the unit
  suites `pace` and `timer`, and the component suite `reading-timer` (16).
  `pnpm typecheck`, `pnpm lint` (no error, no warning in a changed file) and
  `pnpm deadcode` are clean.
- Page weight, main and this branch side by side on dev previews of the same
  backup (KB): `/` 269 and 275, `/reading` 74 and 85, a book being read with
  sessions 373 and 377, another 299 and 302, `/settings/reading` new at 48.
  `node scripts/qa/page-weight.js` on a production-build preview: every route
  within budget (`/` 256 to 268 KB in 35 to 67 ms, `/reading` 95 to 110 KB,
  `/settings/reading` 52 KB in 3 ms), except `/reading/import/*` with no
  import in a fresh database, which #103 (SLN-479) turns into a note. Server
  times on the dev previews were not comparable: the Mac was swapping (about
  23 of 24.5 GB swap used).
- `getPaceContext` server time, from the preview's SQL log
  (`--log-sql`): 171 calls for one to six readings, median 3.7 ms, slowest
  15.9 ms.
- Browsers: Chrome, Firefox and Safari at 1440, 768 and 390 px on a
  production-build preview: the book page with its sessions, the estimate
  popover, Add a session, Edit session, `/settings/reading`, the hub, the
  dashboard, the chip in each layout, the running row, stop mode, the rail
  chip and its menu, "A timer is running for The Door", the discard question
  and after the discard; the chip again at 790 (rail) and 375 (phone). 2,410
  elements checked per browser: no alignment deviation over 0.5 px, no
  control without a name, no overflow, no console error. The only contrast
  findings are the decorative initials of covers the preview has no image
  for. Controls: the rail's Stop and the phone bar's time and Stop are 44 px;
  the expanded chip's buttons are 28 px and 44 px on a touch screen.
- Fixed during the checks: the expanded chip's Pause and Stop sat 9.8 px off
  the time's cap height (now `CapAligned`); the expanded chip had no Discard
  (its time and title now open the same menu as the rail's); the estimate
  popover was a `dialog` role; a production build hides a server action's
  message, so a second timer is now asked about before the server is called
  and a timer stopped elsewhere is said in words from a fresh load; a pace
  from a session of a few seconds ("2585 p. an hour") is not shown under five
  minutes; an estimate breaks between its parts, never inside "Around 25 Oct".
- One timer across browsers: started in Safari, Chrome showed nothing until a
  focus, then "Timer for The Door"; stopped in Safari, Pause in Chrome said
  "This timer was stopped on another device" and the chip went.
- Forgotten timer, in the three browsers at the three widths, with a timer
  at 6 h 12 min: "Your timer for The Door has been running for 6 h 12 min.
  When did you stop?", "Stopped at 10:25" (the start plus the 90-minute
  check) opened stop mode with "You read 1 h 30 min".
- Journeys on the production-build preview: `reading` passes with its new
  steps (start a timer, reload, pause, resume, stop at p. 230, Undo, stop
  again, add and edit a session, the day start hour) and `import` passes. On
  the swapping Mac, a dev preview answered server actions in 4 to 13 s and
  the journey ran past a 10-second Undo toast.
- Curl checks on a production-build preview started with `--api-token` (the
  token read from the preview's log into `$TOKEN`, never printed), and the
  503 checks on one started without it. The live app was never called.

  ```sh
  B=http://127.0.0.1:3251; H="Authorization: Bearer $TOKEN"; J="Content-Type: application/json"
  curl -s $B/api/readings/open                                    # 401 "Durtal refused the token"
  curl -s -H "Authorization: Bearer wrong" $B/api/readings/open   # 401
  curl -s -H "$H" $B/api/readings/open                            # 200 "You are reading Journey Reading, The Door, ..."
  curl -s -X POST -H "$J" -d '{"text":"page 320"}' $B/api/readings/$DANTE/progress                                 # 401
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"page 320","tz":"America/Mexico_City"}' $B/api/readings/$DANTE/progress
      # 200 "Logged page 320 of The Divine Comedy ..., 43%"; the session has America/Mexico_City and its day
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"+20"}' $B/api/readings/$DANTE/progress          # 200 "Logged page 340 ..."
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"70 percent"}' $B/api/readings/$LAUGH/progress   # 200 "Logged page 69 of The Red Laugh, 70%"
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"page 330"}' $B/api/readings/$DANTE/progress     # 200 "Corrected your last log ... to page 330"
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"banana"}' $B/api/readings/$DANTE/progress       # 400 "Enter a page (212), ..."
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"page 331","tz":"Mars/Olympus"}' $B/api/readings/$DANTE/progress   # 400
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"page 10"}' $B/api/readings/$FINISHED/progress   # 409 "Stella Maris is finished; reopen it in Durtal"
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"page 10"}' $B/api/readings/00000000-0000-4000-8000-000000000000/progress   # 404
  curl -s -X POST -H "$H" -H "$J" -d '{}' $B/api/readings/timer/start                          # 400 "Several books are open: ... Say which one"
  curl -s -X POST -H "$H" -H "$J" -d "{\"readingId\":\"$DOOR\",\"tz\":\"America/Mexico_City\"}" $B/api/readings/timer/start   # 200, the timer in that zone
  curl -s -X POST -H "$H" -H "$J" -d "{\"readingId\":\"$DANTE\"}" $B/api/readings/timer/start   # 409 "A timer is running for The Door. Stop it first"
  # (the running timer's start moved back 6 h 12 min in the disposable database)
  curl -s -X POST -H "$H" -H "$J" -d '{"text":"page 62"}' $B/api/readings/timer/stop          # 409 "Your timer for The Door has run 6 h 12 min. Say when you stopped, or stop it in Durtal"
  curl -s -X POST -H "$H" -H "$J" -d "{\"text\":\"page 62\",\"endedAt\":\"$END\"}" $B/api/readings/timer/stop   # 200 "Stopped the timer: 41 min, page 62 of The Door, 22%"
  curl -s -X POST -H "$H" -H "$J" -d '{}' $B/api/readings/timer/stop                           # 404 "No timer is running"
  # (a timer started 13 hours back)
  curl -s -X POST -H "$H" -H "$J" -d "{\"endedAt\":\"$NOW\"}" $B/api/readings/timer/stop    # 400 "Edit the end time; a session can be at most 12 hours"
  curl -s -X POST -H "$H" -H "$J" -d '{}' $B/api/readings                                       # 400 "Send an isbn or a workId"
  curl -s -X POST -H "$H" -H "$J" -d '{"isbn":"1234567890"}' $B/api/readings                   # 400 "That is not an ISBN"
  curl -s -X POST -H "$H" -H "$J" -d '{"isbn":"9780000000002"}' $B/api/readings                # 404 {"message":"Not in Durtal yet","addUrl":"/library/new?isbn=9780000000002"}
  curl -s -X POST -H "$H" -H "$J" -d '{"isbn":"978-2-07-078338-0","tz":"Europe/Amsterdam"}' $B/api/readings   # 201 "Started reading Fragments de Lichtenberg"
  curl -s -X POST -H "$H" -H "$J" -d '{"isbn":"9782070783380"}' $B/api/readings                # 409 "Fragments de Lichtenberg is already being read"
  # Started without --api-token:
  curl -s $B/api/readings/open                                    # 503 "Durtal has no API token set"
  curl -s -X POST -H "$J" -H "Authorization: Bearer anything" -d '{"text":"page 1"}' $B/api/readings/timer/stop   # 503
  ```
- Phone shortcuts: docs/11 documents the Authelia rule for `^/api/readings`.
  Durtal runs on the Mac (`next dev` on :3100, every interface), so a phone on
  the same network reaches it without that rule. docs/05's recipe keeps
  "Works once the access rule in docs/11 is in place" until Joris logs a page
  from his iPhone. His answer is not in yet.
