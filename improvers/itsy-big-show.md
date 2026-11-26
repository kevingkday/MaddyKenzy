# Improver brief: Itsy's Big Show

A touch game for young children, hosted by Itsy the spider (Itsy Bitsy Spider song). Activities:
- **bubbles** (Bubble Pop): free-play hook. Bubbles with pictures, letters or numbers rise; each pop plays a note and says the word.
- **say** (Say It!): shows a picture and asks the child to say it. Any vocal sound counts and makes Itsy dance (microphone loudness only).
- **seq** (Spider Climb): missing number in a sequence.
- **bugs** (Ladybug Friends): +1, −1, +0, −0 with ladybugs.
- **letters** (Letter Sounds): picture → starting letter, or "find the letter".
- **board** (ABC Board): tap a letter, hear name, sound and word; sing the ABCs.
- **sing** (Sing with Itsy): the whole song with the animated scene.
Levels adjust automatically inside the game (5 levels per quiz activity). Wrong answers make the right one glow. Idle or rapid random tapping makes Itsy peek in and highlight the answer.

## Levers in the config
- `activities[]`: `enabled`, `weight` (home ranks by weight × the child's own engagement; the top one is a big pulsing hero tile), `title`, `glyph` (short text/emoji), `color`. Never remove an activity; disable it instead.
- `round_length` (1–8 answers per round), `song_chance` (0–1, a song line after a right answer), `bubble_round`, `bubble_ms` (400–3000), `say_round`
- `rewards` weights `{song, sticker, confetti}`; `stickers` (emoji list)
- `bubble_words` and `say_prompts` (lists of `{w, e}`: word + emoji); `bubble_mix` `{words, letters, numbers}`
- `boredom.idle_seconds` (≥3), `boredom.rapid_taps`

## Event types you'll see
`session, intro, open, close{secs,reason,taps,score}, answer{i,ok,ms,first,lvl}, pop{i}, vocal{i,src}, say_wait{i,n}, reward{r}, round, auto_again, boredom{k:idle|rapid}, replay, level{lvl}, tap{i}, abc_song, mic_off, timer_end, hide`.
`close.reason`: hold = left with the home button, switch, party, timer, grown.
