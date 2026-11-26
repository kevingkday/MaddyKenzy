// The reviewer. Runs in GitHub Actions daily (scripts/daily.mjs) or when a parent taps Review.
// Reads one family's play data from the site's private API, asks Claude for notes and a better
// config for that family's copy of the game, and writes it as a local candidate.
// The workflow then runs scripts/test.mjs on it and scripts/publish.mjs saves it as a suggestion
// that the parent applies (or not) from the grown-ups screen.
// Logs are public on a public repo, so this script never prints play data or notes.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

for (const k of ['SITE_URL', 'INTERNAL_TOKEN']) if (!process.env[k]) { console.log(`Missing GitHub secret ${k}. Add it under Settings -> Secrets and variables -> Actions.`); process.exit(1); }
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const GAME = process.env.GAME, FAMILY = process.env.FAMILY, RUN = process.env.RUN || '';
for (const v of [GAME, FAMILY]) if (!/^[a-z0-9-]{1,40}$/.test(v || '')) throw new Error('bad game/family');
const DIR = `site/games/${GAME}`;
const MODEL = process.env.MODEL || 'claude-opus-5-5';
const MIN_NEW_EVENTS = +(process.env.MIN_NEW_EVENTS || (process.env.MANUAL === 'true' ? 5 : 20));
const api = async (path, body) => {
  if (process.env.CONTEXT_FILE && path.startsWith('/api/internal/context')) return JSON.parse(fs.readFileSync(process.env.CONTEXT_FILE, 'utf8'));
  const r = await fetch(process.env.SITE_URL.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${process.env.INTERNAL_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};

// ---------- summary ----------
function summarise(events) {
  const acts = {}, versions = {}, items = {}, sessions = {}, kids = {};
  for (const e of events) {
    if (e.c && e.a && e.a !== 'grown') { const k = kids[e.c] || (kids[e.c] = { secs: 0, opens: {}, answers: 0, firstRight: 0, vocal: 0, pops: 0, bored: 0, rounds: 0 });
      if (e.e === 'open') k.opens[e.a] = (k.opens[e.a] || 0) + 1; if (e.e === 'close') k.secs += e.secs || 0; if (e.e === 'answer') { k.answers++; if (e.ok && e.first) k.firstRight++; }
      if (e.e === 'vocal') k.vocal++; if (e.e === 'pop') k.pops++; if (e.e === 'boredom') k.bored++; if (e.e === 'round') k.rounds++; }
    const s = sessions[e.s] || (sessions[e.s] = { start: e.t, end: e.t });
    s.end = Math.max(s.end, e.t);
    const v = versions[e.v] || (versions[e.v] = { sessions: new Set(), secs: 0, answers: 0, first: 0, vocal: 0, pops: 0, bored: 0, rounds: 0 });
    v.sessions.add(e.s);
    if (!e.a || e.a === 'grown') continue;
    const a = acts[e.a] || (acts[e.a] = { opens: 0, secs: 0, rounds: 0, answers: 0, firstRight: 0, wrong: 0, msSum: 0, vocal: 0, sayWaits: 0, pops: 0, boredIdle: 0, boredRapid: 0, replays: 0, exits: {}, levels: [] });
    switch (e.e) {
      case 'open': a.opens++; break;
      case 'close': a.secs += e.secs || 0; v.secs += e.secs || 0; a.exits[e.reason] = (a.exits[e.reason] || 0) + 1; break;
      case 'round': a.rounds++; v.rounds++; break;
      case 'answer': a.answers++; v.answers++; a.msSum += e.ms || 0; if (e.ok && e.first) { a.firstRight++; v.first++; } if (!e.ok) a.wrong++;
        if (e.i) { const k = `${e.a}:${e.i}`; const it = items[k] || (items[k] = { right: 0, wrong: 0 }); e.ok && e.first ? it.right++ : (!e.ok && it.wrong++); } break;
      case 'vocal': a.vocal++; v.vocal++; break;
      case 'say_wait': a.sayWaits++; break;
      case 'pop': a.pops++; v.pops++; { const k = `pop:${e.i}`; items[k] = items[k] || { taps: 0 }; items[k].taps = (items[k].taps || 0) + 1; } break;
      case 'boredom': e.k === 'idle' ? a.boredIdle++ : a.boredRapid++; v.bored++; break;
      case 'replay': a.replays++; break;
      case 'level': a.levels.push(e.lvl); break;
    }
  }
  for (const a of Object.values(acts)) {
    a.avgMinPerOpen = a.opens ? +(a.secs / a.opens / 60).toFixed(2) : 0;
    a.firstTryRate = a.answers ? +(a.firstRight / a.answers).toFixed(2) : null;
    a.avgAnswerSec = a.answers ? +(a.msSum / a.answers / 1000).toFixed(1) : null; delete a.msSum;
  }
  const sess = Object.values(sessions).map(s => (s.end - s.start) / 60000).filter(m => m > 0.1);
  const byVersion = Object.fromEntries(Object.entries(versions).map(([k, v]) => [k, { sessions: v.sessions.size, playMinutes: +(v.secs / 60).toFixed(1), firstTryRate: v.answers ? +(v.first / v.answers).toFixed(2) : null, vocalisations: v.vocal, pops: v.pops, roundsFinished: v.rounds, boredomSignals: v.bored }]));
  return {
    totalEvents: events.length, sessions: sess.length,
    medianSessionMinutes: sess.length ? +sess.sort((a, b) => a - b)[Math.floor(sess.length / 2)].toFixed(1) : 0,
    byActivity: acts, byVersion, byChild: kids,
    hardestItems: Object.entries(items).filter(([, x]) => x.wrong).sort((a, b) => b[1].wrong - a[1].wrong).slice(0, 12),
    favouriteBubbles: Object.entries(items).filter(([k]) => k.startsWith('pop:')).sort((a, b) => b[1].taps - a[1].taps).slice(0, 12)
  };
}

// ---------- prompt ----------
const RULES = `You review one family's copy of a children's iPad touch game and suggest changes. The code is shared by every family; you change only this family's config.
The parent reads your notes and decides whether to apply your suggested config. Read the family's goals, the children's profiles and the play data (events carry c = child id when known), then suggest a config so the children stay engaged longer AND learn more.
Success is measured next time by: longer sessions, fewer early exits and boredom signals, more rounds finished, rising first-try accuracy and levels, more vocalisations.
Compare versions in byVersion: keep what moved the numbers, rework what did not. With little data, make modest changes.

Hard rules:
- Only change values the game brief lists as levers. Keep every existing activity id (disable instead of removing).
- No real brands, logos, copyrighted characters or songs. Words and emoji must suit young children.
- Anything the children must understand is spoken or shown as a picture, never text-only.
- "changelog" is one short generic line about the game change (no names, no personal details).
- "notes_for_parent" is private and written to the parent in plain, warm language. Structure it as:
  1. One short paragraph per child (by first name) on what they focused on, what held their attention, where they struggled or drifted, using the numbers. If play wasn't tagged by child, describe it together.
  2. "I recommend:" then 2-5 bullet lines, each a concrete change in your config and why.
  3. Optionally "Idea for later:" for anything that needs new game code.
  Keep it under 220 words.

Reply with ONLY a JSON object:
{"notes_for_parent": "...", "changelog": "...", "config": { ...the complete new config... }}`;

async function askClaude(system, user) {
  if (process.env.MOCK_REPLY) return JSON.parse(fs.readFileSync(process.env.MOCK_REPLY, 'utf8')); // local testing only
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 12000, stream: true, system, messages: [{ role: 'user', content: user }] })
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}`);
  let text = '', buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'error') throw new Error('Claude API stream error');
      if (ev.type === 'content_block_delta' && ev.delta?.text) text += ev.delta.text;
    }
  }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(s, e + 1));
}

function validate(next, cur) {
  const errs = [];
  const ids = (next.activities || []).map(a => a.id);
  for (const a of cur.activities) if (!ids.includes(a.id)) errs.push(`activity ${a.id} removed`);
  for (const id of ids) if (!cur.activities.some(a => a.id === id)) errs.push(`unknown activity ${id}`);
  if (!(next.activities || []).some(a => a.enabled)) errs.push('no activity enabled');
  for (const k of Object.keys(cur)) if (!(k in next) && k !== 'version') errs.push(`missing ${k}`);
  if (next.round_length < 1 || next.round_length > 8) errs.push('round_length out of range');
  if (next.bubble_ms < 400 || next.bubble_ms > 3000) errs.push('bubble_ms out of range');
  if (next.boredom?.idle_seconds < 3) errs.push('idle_seconds too short');
  if (!next.bubble_words?.length || !next.say_prompts?.length || !next.stickers?.length) errs.push('empty content list');
  if (/https?:|<script|javascript:/i.test(JSON.stringify(next))) errs.push('links or markup in config');
  return errs;
}

// ---------- run ----------
const ctx = await api(`/api/internal/context?family=${FAMILY}&game=${GAME}&run=${RUN}`);
console.log(`${ctx.events.length} events, ${ctx.new_since_last} since last improvement`);
if (ctx.new_since_last < MIN_NEW_EVENTS && !process.env.FORCE) {
  if (!process.env.CONTEXT_FILE) await api('/api/internal/run', { family: FAMILY, run: RUN, status: 'no_change', message: `Not enough new play to review yet (${ctx.new_since_last} new events, need ${MIN_NEW_EVENTS}).` });
  console.log('Not enough new play yet.');
  out('changed', 'false'); process.exit(0);
}
const summary = summarise(ctx.events);
const brief = fs.readFileSync(`improvers/${GAME}.md`, 'utf8');
const recent = ctx.events.slice(-400).map(({ t, s, v, ...rest }) => ({ t: new Date(t).toISOString().slice(5, 19), ...rest }));
const sinceText = ctx.since ? new Date(ctx.since).toISOString() : 'the beginning';
const user = `NEW PLAY SINCE LAST REVIEW: ${ctx.new_since_last} events since ${sinceText}. Focus your notes on this recent play; use older data for comparison.\n\nFAMILY GOALS:\n${ctx.goals || 'none given'}\n\nCHILDREN:\n${JSON.stringify(ctx.children)}\n\nCURRENT CONFIG (live version ${ctx.active_version}):\n${JSON.stringify(ctx.config, null, 1)}\n\nPLAY SUMMARY:\n${JSON.stringify(summary, null, 1)}\n\nRECENT VERSIONS (newest first, with your earlier notes and stats):\n${JSON.stringify(ctx.history.map(h => ({ ...h, stats_json: undefined, stats: h.stats_json ? JSON.parse(h.stats_json) : null })))}\n\nLAST 400 EVENTS:\n${JSON.stringify(recent)}`;

const reply = await askClaude(`${RULES}\n\nGAME BRIEF:\n${brief}`, user);
const cur = ctx.config, next = reply.config;
const errs = validate(next || {}, cur);
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
