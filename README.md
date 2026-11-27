# Self-improving kids' games

iPad touch games that rebuild themselves around how a child actually plays. This repo is the live example behind **maddykenzy.com**, and it's set up so other families can run the same thing for their own kids.

**The loop:**
1. The child picks who's playing and plays. Every tap, answer, sound and reward is logged, tagged to that child.
2. **Every night**, any game that was played gets reviewed. A parent can also tap **Review recent play** at any time.
3. Claude reads the new play data plus the family's goals and writes a **suggestion**: plain-language notes per child ("Maddy focused on…") and a revised config for that family's copy of the game.
4. The suggestion must pass automated safety and play tests before it's saved.
5. Nothing changes until the parent taps **Apply** on the grown-ups screen. A dot on the ★ star shows one is waiting. **Undo** returns to the previous version.

## Two loops: it improves the game, and it improves how it improves
```
              ┌──────────────── outer loop: the improver improves itself ────────────────┐
              │                                                                          │
 play ──▶ scorecard ──▶ playbook rethink ──▶ parent approves ──▶ new playbook ───────────┤
  ▲          │                                                                           ▼
  │          └──────────────▶ review (follows the playbook) ──▶ tests ──▶ parent applies ──▶ new game version
  └─────────────────────────────── inner loop: the game improves ─────────────────────────────────┘
```
- **Inner loop (nightly or on demand):** Claude reviews new play, following its current **playbook**, and suggests a config change (one or two levers at a time) with notes per child. It's tested, and the parent applies it.
- **Scorecard (nightly, no AI):** for every applied change, `scripts/scorecard.mjs` compares play on the new version with the version it replaced: play minutes per session, first-try accuracy, sounds made and lost-interest signals. It gives a verdict of helped, hurt, mixed, no change or too early. The numbers are deterministic, so they can be shown and trusted.
- **Outer loop:** once 3 or more changes have measured results (and at least 3 days have passed), `scripts/meta.mjs` has Claude read the scorecard against its own past reasoning and **rewrite its playbook**. It keeps rules behind changes that helped, drops what hurt, and cites versions as evidence. The parent approves the new playbook, and every later review follows it.

Starter playbook: `improvers/starter-playbook.md`. Tables: `version_outcomes`, `playbooks`.

## What's public and what's private
| Public (this repo) | Private (Cloudflare D1, per family) |
|---|---|
| Game code, shelf, server functions, improver, tests | Play events, each family's game configs and versions |
| Starter config for each game (`site/games/<game>/game.json`) | Parent goals, children's profiles, the improver's notes to the parent |
| The improver's game briefs (`improvers/<game>.md`) | PINs, improve-run history |

The improver runs in GitHub Actions but reads and writes only through the site's token-protected `/api/internal/*` endpoints. It never commits anything, and it never prints play data or notes to the (public) Action logs.

## Families, sign-up and privacy (beta)
- **Invite-only sign-up.** The admin makes an invite link in the parent dashboard (`/app`). The parent opens it, signs in (links are one-time and there are no passwords), and fills in **Create your family's game**: kids' names, ages and what they're like, goals, an optional school-newsletter photo, and a grown-ups PIN. Claude writes the family's first version of the game from those notes.
- **Kid devices** are linked with a one-time code or QR code from the dashboard. The game keeps a device token, and every request from it counts toward that family.
- **Encryption.** Names, notes, goals, the AI's notes about each child and the playbooks are stored encrypted (AES-256-GCM) with a separate key per family (`lib/crypto.js`). Anyone who copies the database sees only `enc:v1:…`.
  - **Standard:** the family key is locked with `MASTER_KEY`, a Cloudflare secret that is never in the database. Nightly reviews run automatically.
  - **Private mode:** the family key is locked with the parent's passphrase in their browser (PBKDF2), and the server never stores it unlocked. Reviews run inside a request the parent makes from the dashboard. Nobody else, including the site owner, can open the notes, and a forgotten passphrase can't be recovered.
  - Not encrypted: play events (taps, answers, timings), scorecard numbers, and each game's settings (words, emoji, pacing), because devices and the scorecard need them. During a review the notes are sent to Claude to be read.
- **Export and delete:** the dashboard has **Download our data** and **Delete our family** (which permanently erases everything).

## How it fits together
```
site/                     static site served by Cloudflare Pages
  index.html …            the game shelf
  games/<game>/           each game: its own installable app (index.html, game.json, sw.js, manifest, icons)
functions/api/            Cloudflare Pages Functions (D1 binding "DB")
  log                     POST play events          ─┐
  config                  GET this family's live config │ family = site address (family_domains table)
  children                first names for the picker  │
  review / status         ask for a review, check it  │
  notes                   waiting suggestion + history│ (PIN)
  apply / dismiss / undo  parent decisions           ─┘ (PIN)
  internal/*              families, pending, context, propose, scorecard, playbook, voice, run (jobs only; Bearer INTERNAL_TOKEN)
lib/server.js             shared helpers: family lookup, PIN check, token check
db/schema.sql             multi-family schema (db/migrations/ for upgrades)
improvers/<game>.md       what the improver may change in each game
scripts/                  daily.mjs (nightly) · scorecard.mjs · improve.mjs → test.mjs → publish.mjs · meta.mjs (playbook) · voice.mjs · fail.mjs
.github/workflows/improve.yml   nightly schedule + on-demand reviews
wrangler.toml             Pages settings and D1 binding as code
```

### The database (db/schema.sql)
`families` → `family_domains` (which address is whose) · `children` (private profiles) · `devices` ·
`games` (shared templates) → `family_games` (a family's copy, goals, live version, last review time) → `game_versions` (every config with status proposed / live / dismissed, changelog, private notes, stats, undo flag) ·
`events` (every interaction, per family/game/child) · `improve_runs`.

## Setup
### Cloudflare
1. Create the D1 database and load the schema: `npx wrangler d1 create <name>`, put its id in `wrangler.toml`, then `npx wrangler d1 execute <name> --remote --file db/schema.sql`. (Existing databases: run the files in `db/migrations/` you haven't applied yet.)
2. **Workers & Pages → Create → Pages → Connect to Git** and pick this repo. Build command: empty. Output: `site` (read from `wrangler.toml`).
3. In **Settings → Variables and secrets**, add these secrets: `MASTER_KEY` (32 random bytes, base64; **keep a copy somewhere safe, because losing it loses every standard family's notes**), `ANTHROPIC_API_KEY` (for onboarding and private-mode reviews), `INTERNAL_TOKEN` (long random string), `GH_TOKEN` (below) and optionally `PARENT_PIN` (a fallback PIN for families without their own).
4. Add your domain under **Custom domains**.

### GitHub
- Secrets: `ANTHROPIC_API_KEY`, `INTERNAL_TOKEN` (same value as Cloudflare), `SITE_URL` (e.g. `https://maddykenzy.com`). Optional variable `MODEL`.
- `GH_TOKEN` for Cloudflare: a fine-grained token on this repo only, with **Contents: Read and write** (needed to send repository_dispatch) and **Actions: Read**.

### Add a family
Use an invite link from the parent dashboard (admin). The SQL below is only for scripted setups. It stores plaintext, which the nightly upgrade (`/api/internal/encrypt-existing`) then encrypts.
```sql
INSERT INTO families (id, name) VALUES ('smith', 'The Smiths');
INSERT INTO family_domains (domain, family_id) VALUES ('smithkids.com', 'smith');
INSERT INTO children (id, family_id, display_name, profile_private) VALUES ('sam', 'smith', 'Sam', 'Loves trains; working on letter sounds');
INSERT INTO family_games (family_id, game_id, active_version, goals_private) VALUES ('smith', 'itsy-big-show', 1, 'Counting to 20');
INSERT INTO game_versions (family_id, game_id, version, config_json, created_by, status, applied_at) VALUES ('smith', 'itsy-big-show', 1, '<contents of site/games/itsy-big-show/game.json>', 'seed', 'live', unixepoch() * 1000);
INSERT INTO playbooks (family_id, game_id, version, content, status, applied_at) VALUES ('smith', 'itsy-big-show', 1, '<contents of improvers/starter-playbook.md>', 'live', unixepoch() * 1000);
```

## Using it
- On the iPad, open the game in Safari, tap **Share**, then **Add to Home Screen**.
- Grown-ups screen: hold the ★ star for 2 seconds. With your PIN you can read the waiting suggestion and **✅ Apply** it or tap **Not now**, **🔍 Review recent play**, **↩ Undo**, browse the private history, set the play timer and adjust levels.
- The nightly review needs 20 new play events since the last review. A manual review needs 5.

## Voice (optional, ElevenLabs)
Every line the game says can play in a family's own voice, e.g. a parent's ElevenLabs voice clone.
- Set `families.voice_id` for the family, and add the GitHub secret `ELEVENLABS_API_KEY` (optional variable `ELEVENLABS_MODEL`).
- **Actions → voice → Run workflow** with `sample` makes a few lines to try (Grown-ups → Voice → ▶ Play samples). `all` makes every line, about 450 short clips.
- `scripts/voice.mjs` asks the game itself for every line it can say (`window.__itsy.phrases`), splits them into sentence and comma pieces, and makes only the missing ones. Clips are stored in D1 (`voice_clips`) and served from `/audio/<voice>/<hash>.mp3`.
- Any piece without a clip plays in the iPad voice and is logged as `tts_miss`. The nightly review then makes it, along with clips for any new words in a suggestion.

## Safety checks (every new version)
`scripts/test.mjs` must pass before a config goes live. It checks:
- no outside connections, recording or eval
- hold-to-leave, the timer and the grown-ups screen are intact
- every activity loads and plays on an iPad, in landscape and portrait
- no script errors and no overflow

The reviewer may only change config values its game brief lists, and may not remove activities. The microphone only measures loudness on the device; audio is never recorded or sent.

## Adding a game
Put it in `site/games/<id>/` with a `game.json`, the same `track()` calls and grown-ups screen as Itsy's Big Show, and an `improvers/<id>.md` brief. Add it to `site/games.json` and insert a `games` row.

## Beta sign-ups

The homepage has an email-only beta list (`POST /api/beta`). Addresses are stored encrypted (a key derived from `MASTER_KEY`), deduped with a keyed hash, rate-limited per IP, and listed for the admin in the parent dashboard.

Optional email alert for each new sign-up, through Cloudflare Email Service (free when sending to a verified address on your own account):

1. Cloudflare → Email Service → Email Routing: turn it on for your domain, and add and verify your own address under Destination addresses.
2. Create an API token with **Email Sending: Edit**.
3. Add to the Pages project: `NOTIFY_EMAIL` (your verified address), `CF_EMAIL_TOKEN` (secret), `CF_ACCOUNT_ID`, and optionally `NOTIFY_FROM` (defaults to `beta@<your domain>`).
