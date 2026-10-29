# Siberian Wolf — standalone personal recreation

Open **index.html** in a modern browser. The game works offline, without an
installer, server, account, or build step. Keep this folder and its assets together.

## Play

- LINES +/− selects 1–9 paylines; BET +/− selects 1–5 credits per line.
- The numbered lamps also select lines; hover over one to preview its path.
- SPIN or Space spins. STOP immediately reveals the already determined result.
- Sound starts after your first click or keypress. Sound: on/off toggles the six
  original clips for controls, spinning, reel stops, payouts, bonus entry, and
  snowflake picks. The preference saves locally. Muting stops playing clips
  immediately; sounds also stop while the browser tab is hidden.
- BET MAX selects 9 lines × 5 credits and spins.
- The coin beside CREDITS selects the six original denominations: 5¢, 25¢,
  $1, $5, $25, and $100. Changing it preserves the cash balance, including
  amounts smaller than a whole credit. Wagers and awards use integer cents.
- BANK displays simulated cash; CREDITS displays whole available credits.
  WIN and the pay table use credits. The initial balance is 1,000 credits at 5¢.
- PAY TABLE lists the recovered payouts and bonus rules. Winning lines cycle
  automatically after a spin.
- CASH OUT displays the simulated balance. It does not pay money or remove
  credits. New game replaces the balance with 1,000 credits at the current
  denomination after confirmation.
- The browser saves balance, settings, sound preference, settled reels, and unfinished bonus picks
  locally when storage is available. Wagering locks during spins and bonuses.

## Recovered data and fidelity

Artwork comes from the **Casino Mega Collection (2015)** disc, resource bundle
15, and six original game sounds come from bundle 16. Only Siberian Wolf (`serbia_*`, `syberia_*`) and shared video-slot controls
and paylines are included. The original guide is in `assets/guide_slots.xml`;
`assets/manifest.json` records source paths and SHA-256 hashes.

The executable in installer stream 12 contains the Siberian Wolf initialization
at virtual address `0x524f71`. It selects five 28-stop reels at `0x54a228` and
28 six-word payout records at `0x549c90`. Those tables are extracted into
`assets/game-data.js`. Each displayed reel uses three consecutive stops.
The line evaluator at `0x526550` tests the ordered payout rows, with `-1`
accepting any remaining symbol; the first matching record pays. Siberian Wolf
does not use the wild substitution branches for other games.

The nine line paths match the recovered payline images and evaluator paths.
Line wins start on the leftmost reel and pay for 2–5 matching symbols, multiplied
by bet per line. The highest matching payout per active line pays.

The bonus trigger at `0x528750` counts reels with at least one visible snowflake;
three or more trigger a bonus regardless of active lines. The bonus initializer
at `0x528810` specifies 14 concealed picks: one COLLECT, six 1s, three 2s, two 3s,
one 4, and one 5. Revealing COLLECT ends the bonus and awards the accumulated
values times bet per line. The collect handler at `0x528c30` awards all 27 units
if COLLECT is picked first. Bonus credits add to base-game wins.

This is newly written browser software using the original artwork and recovered
tables, not the original executable. Reel-stop selection and bonus shuffling use
unbiased browser cryptographic randomness. Animation, timing, storage, and the
bonus arrangement are recreated. The original random-selection code and overall
return percentage are not reproduced or claimed. Sound uses the recovered
`click`, `spin`, `stop`, `pay`, `clear`, and `snowflake` Ogg clips.

The game uses play credits only, with no deposits, purchases, withdrawals, or
external services. Original artwork belongs to its original creators. This is
an offline personal recreation, not a publication.

## Regenerate assets

Run `python extract_assets.py` with Python 3. It defaults to the disc in
`~/Downloads/CasinoMegaCollection/Casino Mega Collection (2015).bin`.
An alternative BIN path can be passed as the first argument. No third-party
Python packages are required.

The extractor reads the MODE2/2352 ISO directory and the Wise installer's DEFLATE
streams, verifies their CRC32 checksums, extracts selected resources, and reads
the executable's data tables. It never installs or executes the original software
and does not alter the disc image or Little Green Men app.
