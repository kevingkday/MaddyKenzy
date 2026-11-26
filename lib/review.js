// The reviewer's "brain": prompts, play summary, checks and the Claude call.
// Used by the nightly job (scripts/*.mjs in GitHub Actions) and by in-request reviews in Cloudflare
// (private-mode families, whose notes can only be unlocked inside a request the parent makes).
import { BRIEFS, STARTER_PLAYBOOK } from './briefs.js';
export { BRIEFS, STARTER_PLAYBOOK };

export function summarise(events) {
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

export const RULES = `You review one family's copy of a children's iPad touch game and suggest changes. The code is shared by every family; you change only this family's config.
The parent reads your notes and decides whether to apply your suggested config. Read the family's goals, the children's profiles and the play data (events carry c = child id when known), then suggest a config so the children stay engaged longer AND learn more.
Success is measured next time by: longer sessions, fewer early exits and boredom signals, more rounds finished, rising first-try accuracy and levels, more vocalisations.
Compare versions in byVersion: keep what moved the numbers, rework what did not. With little data, make modest changes.
Follow YOUR PLAYBOOK (rules you wrote from earlier results). Change only one or two levers per suggestion, so the SCORECARD can measure each change on its own.

Hard rules:
- Only change values the game brief lists as levers. Keep every existing activity id (disable instead of removing).
- No real brands, logos, copyrighted characters or songs. Words and emoji must suit young children.
- Anything the children must understand is spoken or shown as a picture, never text-only.
- "changelog" is one short generic line about the game change (no names, no personal details).
- "notes_for_parent" is private and written to the parent in plain, warm language. Structure it as:
  0. If the SCORECARD has a result for your last applied change, start with one sentence on it (e.g. "Last change (shorter rounds) helped: play per session went from 3 to 4 minutes.").
  1. One short paragraph per child (by first name) on what they focused on, what held their attention, where they struggled or drifted, using the numbers. If play wasn't tagged by child, describe it together.
  2. "I recommend:" then 2-5 bullet lines, each a concrete change in your config and why.
  3. Optionally "Idea for later:" for anything that needs new game code.
  Keep it under 220 words.

Reply with ONLY a JSON object:
{"notes_for_parent": "...", "changelog": "...", "config": { ...the complete new config... }}`;

export function reviewPrompt(ctx, game) {
  const summary = summarise(ctx.events);
  const recent = ctx.events.slice(-400).map(({ t, s, v, ...rest }) => ({ t: new Date(t).toISOString().slice(5, 19), ...rest }));
  const book = ctx.playbook?.content || STARTER_PLAYBOOK;
  const sinceText = ctx.since ? new Date(ctx.since).toISOString() : 'the beginning';
  const user = `YOUR PLAYBOOK (v${ctx.playbook?.version || 1}; follow it):\n${book}\n\nSCORECARD (measured effect of each applied change vs the version it replaced):\n${JSON.stringify(ctx.outcomes || [])}\n\nNEW PLAY SINCE LAST REVIEW: ${ctx.new_since_last} events since ${sinceText}. Focus your notes on this recent play; use older data for comparison.\n\nFAMILY GOALS:\n${ctx.goals || 'none given'}\n\nCHILDREN:\n${JSON.stringify(ctx.children)}\n\nCURRENT CONFIG (live version ${ctx.active_version}):\n${JSON.stringify(ctx.config, null, 1)}\n\nPLAY SUMMARY:\n${JSON.stringify(summary, null, 1)}\n\nRECENT VERSIONS (newest first, with your earlier notes and stats):\n${JSON.stringify((ctx.history || []).map(h => ({ ...h, stats_json: undefined, stats: h.stats_json ? JSON.parse(h.stats_json) : null })))}\n\nLAST 400 EVENTS:\n${JSON.stringify(recent)}`;
  return { system: `${RULES}\n\nGAME BRIEF:\n${BRIEFS[game]}`, user, summary };
}

export function validate(next, cur) {
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

export const META_SYSTEM = `You are the reviewer of a children's iPad game, and you keep a PLAYBOOK: the rules you follow when you suggest changes to this family's copy of the game.
Your suggestions are applied by the parent, and a SCORECARD then measures what each applied change actually did versus the version it replaced
(helped / hurt / mixed / no_change / too_early, with the numbers).

Rewrite your playbook from that evidence:
- Keep rules whose changes helped; drop or reverse rules behind changes that hurt; note what made no difference so you stop spending changes on it.
- Add specific, testable rules you've learned (e.g. "reward variety moved play time more than difficulty timing did [v3, v5]"). Cite versions in brackets.
- Always keep a rule to change only one or two levers per suggestion, so results stay measurable.
- If the evidence is thin or mixed, make small edits and say so. Don't overfit to one result.
- If the parent dismissed an earlier playbook update, take their decision into account.
- Up to 12 bullet lines, under 300 words. No links or markup beyond "- " bullets.

Also write "rationale_for_parent": 2-4 plain, warm sentences on what the scorecard showed and how your approach will change.

Reply with ONLY a JSON object: {"playbook": "- ...\\n- ...", "rationale_for_parent": "..."}`;

export function metaPrompt(ctx) {
  return `FAMILY GOALS:\n${ctx.goals || 'none given'}\n\nCURRENT PLAYBOOK (v${ctx.live?.version || 1}):\n${ctx.live?.content || '(none)'}\n\nSCORECARD:\n${JSON.stringify(ctx.outcomes)}\n\nRECENT VERSIONS (newest first, with your notes when you suggested them):\n${JSON.stringify(ctx.versions)}\n\nPLAYBOOK UPDATES THE PARENT DISMISSED:\n${JSON.stringify(ctx.dismissed)}`;
}
export function checkPlaybook(reply) {
  const book = String(reply.playbook || '').trim(), why = String(reply.rationale_for_parent || '').trim();
  const bullets = book.split('\n').filter(l => l.trim().startsWith('- ')).length;
  if (bullets < 2 || book.length > 3000 || /https?:|<\w/i.test(book + why)) throw new Error('Rejected playbook: wrong shape');
  return { book, why };
}

export const STARTER_SYSTEM = `You set up a new family's copy of a children's iPad touch game. The code is shared; you write this family's first config.
Read the parent's notes about each child (and the school newsletter image, if given), then adapt the starter config to them:
words, pictures (emoji), "say it" prompts, stickers, activity order and weights, round length, pacing and rewards, so the game grabs these children's
attention and works on their goals. Stay within the levers in the game brief; keep every activity id; keep values in range.
Write "notes_for_parent": 3-6 warm, plain sentences on how you tailored the game and what to watch for in the first week.
"changelog": one short generic line (no names or personal details).
Reply with ONLY a JSON object: {"notes_for_parent": "...", "changelog": "...", "config": { ...complete config... }}`;

export function starterPrompt(form, defaultConfig, game) {
  const text = `GAME BRIEF:\n${BRIEFS[game]}\n\nSTARTER CONFIG:\n${JSON.stringify(defaultConfig, null, 1)}\n\nCHILDREN:\n${JSON.stringify(form.children)}\n\nFAMILY GOALS:\n${form.goals || 'none given'}${form.image ? '\n\nThe attached image is from the parent (e.g. a school newsletter). Use any learning goals in it.' : ''}`;
  if (!form.image) return text;
  return [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: form.image } }, { type: 'text', text }];
}

// One Claude call; returns the parsed JSON object from the reply.
// opts: {apiKey, model, mock} (mock = a JSON string, for local tests only)
export async function callClaude(opts, system, content, maxTokens = 8000) {
  if (opts.mock) return JSON.parse(opts.mock);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: opts.model || 'claude-opus-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content }] })
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}`);
  const j = await r.json();
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(s, e + 1));
}
