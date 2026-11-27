// The reviewer (nightly via scripts/daily.mjs, or when a parent taps Review). It reads one family's play data
// from the site's private API, asks Claude (lib/review.js) for notes and a better config, and writes a local
// candidate. The workflow then runs scripts/test.mjs on it and scripts/publish.mjs saves it as a suggestion.
// Private-mode families are reviewed inside Cloudflare instead (only the parent can unlock their notes).
// Logs are public on a public repo, so this script never prints play data or notes.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { api, claudeOpts } from './improve-api.mjs';
import { reviewPrompt, validate, callClaude } from '../lib/review.js';

const out = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const GAME = process.env.GAME, FAMILY = process.env.FAMILY, RUN = process.env.RUN || '';
for (const v of [GAME, FAMILY]) if (!/^[A-Za-z0-9_-]{1,40}$/.test(v || '')) throw new Error('bad game/family');
const DIR = `site/games/${GAME}`;
const MIN_NEW_EVENTS = +(process.env.MIN_NEW_EVENTS || (process.env.MANUAL === 'true' ? 5 : 20));

const ctx = process.env.CONTEXT_FILE ? JSON.parse(fs.readFileSync(process.env.CONTEXT_FILE, 'utf8')) : await api(`/api/internal/context?family=${FAMILY}&game=${GAME}&run=${RUN}`);
console.log(`${ctx.events.length} events, ${ctx.new_since_last} since last review`);
if (ctx.new_since_last < MIN_NEW_EVENTS && !process.env.FORCE) {
  if (!process.env.CONTEXT_FILE) await api('/api/internal/run', { family: FAMILY, run: RUN, status: 'no_change', message: `Not enough new play to review yet (${ctx.new_since_last} new events, need ${MIN_NEW_EVENTS}).` });
  console.log('Not enough new play yet.');
  out('changed', 'false'); process.exit(0);
}
const { system, user, summary } = reviewPrompt(ctx, GAME);
const reply = await callClaude(claudeOpts(), system, user);
const next = reply.config;
const errs = validate(next || {}, ctx.config, GAME);
if (errs.length) throw new Error('Rejected config: ' + errs.join('; '));
next.version = ctx.active_version + 1; // display only; the server assigns the real number

fs.writeFileSync(`${DIR}/game.json`, JSON.stringify(next, null, 2) + '\n');   // local candidate for the tests; never committed
execSync(`node scripts/sync-cfg.mjs ${GAME}`, { stdio: 'ignore' });
fs.writeFileSync('.candidate.json', JSON.stringify({
  family: FAMILY, game: GAME, run: RUN, config: next, upTo: ctx.upTo,
  changelog: String(reply.changelog || 'Tuned the game').slice(0, 200),
  notes: String(reply.notes_for_parent || ''),
  stats: { sessions: summary.sessions, medianSessionMinutes: summary.medianSessionMinutes, byVersion: summary.byVersion, byChild: summary.byChild }
}));
console.log('Candidate config ready for safety checks.');
out('changed', 'true');
