# CLAUDE.md

Context for working in this repo. Read this before changing gameplay, scoring, or employee access.

## What this is

**Gamethon** is a one-time, timed browser game event for Indira IVF employees (run by the Culture Club). Employees log in with their Employee ID and name, play a fixed sequence of challenges against a countdown, and land on an admin leaderboard.

- Remote: `github.com/indiraivf2015/Gamethon` (branch `main`)
- Deployed on **Railway** (`railway.json`): builds the frontend, then the Express backend serves `frontend/dist` and the API from one process.
- Database: **PostgreSQL** (UAT DB `game_uat` on RDS, reached locally via an SSH tunnel on port 15432; see `backend/.env.example`).

## Current game lineup (fertility theme)

Three challenges, played in order:

| # | Section id | Title | Mechanic |
|---|------------|-------|----------|
| 1 | `wordsearch` | Fertility Word Search | 14×14 random grid. Click first and last letter of a word (8 directions). Words: EMBRYO, OVARY, SPERM, UTERUS, ZYGOTE, FOLLICLE, PLACENTA, HORMONE. |
| 2 | `crossword` | Fertility Crossword | Fixed 11×11 layout with 8 IVF clues (BLASTOCYST, IVF, TRIMESTER, FALLOPIAN across; OVULATION, ICSI, ESTROGEN, CERVIX down). Players type answers, then press **Check Answers**. |
| 3 | `sudoku` | Sudoku | 9×9, freshly generated per game (shuffled valid grid, 36 blanks / 45 givens). Players type 1–9, then press **Check Answers**. Judged by Sudoku rules (no stored solution), so any valid completion wins. |

Earlier versions had eight Bollywood games (Shammi puzzle, guess the movie, maze, guess the actress, star runner, memory, tic-tac-toe, Bollywood word search). That code has been **removed**. Its leftovers are still around: images in `frontend/public/images/`, Bollywood stickers used as page decoration (`SECTION_DECO`/`ARENA_DECO`), the page `<title>`, and unused CSS (`.runner-*`, `.memory-*`, `.maze-*`, etc.) in `gamezone.css`.

### Scoring rules (`frontend/index.html`)

- `POINTS_PER_SECTION = 50`, `WRONG_PENALTY = 5`, so `MAX_SCORE = 150` (3 × 50).
- A section's score is 50 minus 5 per wrong attempt, with a floor of −50. Score is banked only when the section is solved. Sections never reached score 0. For the section in progress at timeout, `endGame()` gives 0 if it had no wrong attempts, but `50 − 5×wrongs` if it had any. That's an existing quirk: a few wrong attempts score better than none.
- Word search: each wrong line selection (3+ letters that don't form an unfound word) costs one penalty.
- Crossword: only **fully filled** unsolved words are judged on Check. Correct words lock (turn green). **One penalty per Check press** that has at least one wrong word, no matter how many words are wrong. Wrong squares turn red until edited.
- Sudoku: on Check, any player-entered square that repeats a digit in its row, column or box turns red, and the check costs **one penalty** (regardless of how many clash). No clashes with blanks left gives an info message, no penalty. Full grid with no clashes solves it.
- Leaderboard order: highest score, then most games solved, then fastest time.
- `backend/routes/players.js` has its own `MAX_SCORE = 150` (used in the "already played" message), and the initial `breakdown` keys (`wordsearch`, `crossword`, `sudoku`) are set at login. **Keep both in sync with the frontend's `SECTION_IDS` and scoring constants.**

### Adding or changing a game

All game code lives in the single inline `<script>` in `frontend/index.html`. Section ids drive everything, so a new game must be wired into:
1. `SECTION_IDS`, `GAME_STEPS` (sidebar progress), `GAME_TITLES`, `CHALLENGE_CARDS` (start screen)
2. Per-game state in `startGame()` → `gameState`
3. Dispatch in `renderCurrentGame()`
4. `buildBreakdownPayload()` (what gets saved to the DB)
5. Initial `breakdown` in `backend/routes/players.js` login handler
6. Start-screen heading ("Three Challenges") and `MAX_SCORE` in the backend

A game finishes by calling `advanceGame('solved')`. Penalties go through `applyWrongPenalty(sectionId)` + `wrongAnswerFeedback(sectionId)`. Use `escapeHtml()` for any dynamic text put into `innerHTML`.

**Crossword layout:** `CROSSWORD_WORDS` holds hand-verified row/col/dir positions. `buildCrosswordLayout()` throws on a letter conflict when the page loads, and works out clue numbers itself (row-major scan). If you change words, regenerate the layout with a placement script and check intersections and that no letters touch side-by-side by accident. Don't hand-edit coordinates.

## Repo layout

```
backend/                      Express (ESM, "type": "module") + pg
  index.js                    App entry; serves /api and frontend/dist (SPA fallback)
  db.js                       Pool, initDb() creates gamethon_players and seeds allowlist if empty
  eventWindow.js              Event time window + per-player 20-min session limit
  routes/players.js           /api/players: login, lookup, save progress, list, leaderboard, clear
  seedAllowedEmployees.js     gamethon_allowed_employees table, validation (ID + name match)
  data/allowed-employees.js   Source-of-truth allowlist array (ALLOWED_EMPLOYEES)
  testUsers.js                TEST_EMP_IDS: can play anytime and replay
  scripts/                    setup-db.js, seed-employees.js (force re-seed), test-connection.js
frontend/                     Vite (no framework; vanilla JS in index.html)
  index.html                  The entire UI + all game logic (inline script, IIFE)
  styles/gamezone.css         SOURCE stylesheet
  public/styles/gamezone.css  COPY generated by scripts/copy-public-assets.js on dev/build
  src/assets/images/          Source images, copied to public/images on dev/build
  vite.config.ts              Dev server :3000, proxies /api → :4000
Employee list -franchise.xlsx Franchise KAM list (input for the allowlist; untracked)
```

Edit `frontend/styles/gamezone.css`. The `public/` copy is overwritten on `npm run dev`/`build`. (Both are committed, so keep them identical.)

## Commands

```bash
npm run install:all          # install backend + frontend deps (no root node_modules)
npm run dev                  # backend :4000 + frontend :3000 (Vite proxies /api)
npm run build                # build frontend → frontend/dist
npm start                    # production backend (serves dist if present)
npm run seed:employees --prefix backend   # force-upsert ALLOWED_EMPLOYEES into the DB
npm run setup:db --prefix backend
```

Setup: copy `backend/.env.example` to `backend/.env` and fill in the PG credentials. Set `EVENT_BYPASS=true` for local testing outside the event window.

There is no test suite. To verify a change, at minimum run `npm run build` and play through the flow (log in as a test user → start → finish → results → admin).

## Employee access

- Login needs an **active** Employee ID in `gamethon_allowed_employees`, and the name must match **exactly** after trim, whitespace collapse, and lower-casing (`NAME_MISMATCH` otherwise).
- The frontend looks up the ID while the player types (`/api/players/lookup/:empId`) and confirms it.
- **Each employee can play once.** A finished session blocks re-login (`ALREADY_PLAYED`). Test IDs in `backend/testUsers.js` are exempt and skip the event window.
- To add people: append to `backend/data/allowed-employees.js` (IDs upper-case, e.g. `IIHL…` / `IIHPL…`), then run `seed:employees`. `initDb()` only seeds when the table is **empty**, so a redeploy alone does **not** add new employees.

## Event window and timers

- Event window comes from `EVENT_START_AT` / `EVENT_END_AT` (IST, default 17 Jul 2026 4–5 pm). The frontend has the same defaults hardcoded as a fallback in `refreshEventStatus()`. Update both when the event date changes.
- Session length: 20 min (`SESSION_DURATION_MS` backend, `TOTAL_TIME` frontend), capped at the event end time. Game timer = min(20 min, time to event end, session remaining).
- Status values saved per player: `In Progress`, `Completed`, `Timeout`, `Event Ended`, `Session Expired`.

## Admin panel

- Opened from the Admin button. The password check is **client-side only** (hardcoded in `showAdminLogin()` in `index.html`), and the admin API routes (`GET/DELETE /api/players`) have **no server-side auth**. Treat this as a known weakness. Don't make it worse, and prefer moving auth to the backend if you touch it.
- The README's admin passwords are out of date. Trust the code.

## Conventions

- Plain ES modules, 2-space indent, single quotes. No TypeScript in practice, despite `tsconfig.json`.
- The frontend re-renders whole screens with `app.innerHTML = ...` and re-binds listeners after each render. The crossword is the exception: it updates highlights in place while you type, so inputs keep focus, and only fully re-renders on Check.
- Commit style: Conventional-ish (`feat:`, `fix:`) with a descriptive body.
