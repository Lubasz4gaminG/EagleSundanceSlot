# Siberian Wolf shared leaderboard

This is a separate Cloudflare Worker and SQLite-backed Durable Object, named
`siberian-wolf-leaderboard` and `SlotLeaderboard`. Its single object is named
`siberian-wolf.v1`. It has its own storage; it does not bind to another game's
Worker or Durable Object namespace.

The board keeps three payouts, ranked by integer cents descending. Equal payouts
keep their server insertion order. A new payout equal to third place does not
displace that entry. Initials are three uppercase ASCII letters or digits;
different entries may use the same initials. One entry represents a completed
spin including its bonus, before deducting the wager.

The browser assigns each spin a UUID and preserves the pending entry across a
reload. Identical submissions of a retained UUID return its existing rank;
conflicting details return 409. Once an entry falls out, an identical delayed
retry cannot qualify against the higher cutoff. Insert, ranking and trimming
execute in one SQLite transaction. Only the top three entries are retained;
this is not a historical payout ledger.

## Trust model

Payouts are reported by the browser, as approved for this version. Request
validation checks UUIDs, initials, integer cents and a conservative maximum
derived from the game's tables. It does not prove a payout was earned. There
are no player accounts, private player records or administrative write keys
in the frontend. CORS limits browser access; it is not authentication and
does not prevent a custom client from submitting fabricated results.

`ALLOWED_ORIGINS` includes the GitHub Pages origin and the literal origin `null`
for directly opened offline game files. The game itself works offline, but
shared scores require an internet connection. On a failed qualification check,
Refresh can retry the latest payout before the player starts another spin.
A failed submission keeps the initials prompt open for an idempotent retry.
Skip discards that score entry. Clearing browser storage loses pending entries,
but does not erase the shared board.

## Run and deploy

From this directory, with Node.js 22 or newer:

```powershell
npm install
npm test
npm run validate
npx wrangler login
npm run deploy
```

The pinned tools match the tested runtime. `test.cjs` uses isolated local
Cloudflare runtimes, including SQLite persistence and concurrent submissions.
It does not send test scores to the deployed board.

Deployment creates the new Worker and its `new_sqlite_classes` migration. Keep
the deployed Worker name, class, binding and object name stable to retain its
board. A hostname change alone does not migrate storage. Use a separate Worker
and namespace for future staging. The public Worker URL belongs in
`LEADERBOARD_URL` near the top of `../game.js`; it is not a secret.

## HTTP API

- `GET /health`: service health without a score submission.
- `GET /v1/scores`: `{scores:[{id,initials,cents}]}`, at most three rows.
- `POST /v1/scores`: JSON `{id,initials,cents}`; responds with the current scores,
  `accepted`, and `rank` (1–3, or 0 when displaced/not qualifying).
- `OPTIONS /v1/scores`: browser preflight.

POST requires an allowed Origin header and `application/json`, and caps the
request at 512 bytes. UUIDs are version 4, and cents must be a positive multiple
of five within the game's conservative maximum. Responses are not cached.
Qualification is always rechecked during POST, so another player may displace
an entry between the initials prompt and submission.

There is no public reset, delete or score-edit endpoint.
