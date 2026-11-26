// Scorecard: for every change the parent applied, compare how the children played on it
// against the version it replaced. Deterministic (no AI), so the numbers can be trusted and shown.
//   FAMILY=maddykenzy GAME=itsy-big-show node scripts/scorecard.mjs
import { api } from './improve-api.mjs';
const FAMILY = process.env.FAMILY, GAME = process.env.GAME || 'itsy-big-show';
const MIN_SESSIONS = +(process.env.MIN_SESSIONS || 3);

export function metrics(evs = []) {
  const ses = new Map();
  for (const e of evs) {
    if (!e.a || e.a === 'grown') continue;
    const s = ses.get(e.s) || { secs: 0, answers: 0, first: 0, sounds: 0, bored: 0, rounds: 0 };
    if (e.e === 'close') s.secs += Number(e.secs) || 0;
    if (e.e === 'answer') { s.answers++; if (e.ok && e.first) s.first++; }
    if (e.e === 'vocal') s.sounds++;
    if (e.e === 'boredom') s.bored++;
    if (e.e === 'round') s.rounds++;
    ses.set(e.s, s);
  }
  const list = [...ses.values()].filter(s => s.secs > 0 || s.answers || s.sounds), n = list.length;
  const sum = k => list.reduce((a, s) => a + s[k], 0), answers = sum('answers');
  const r1 = x => Math.round(x * 10) / 10;
  return {
    sessions: n,
    playMinPerSession: n ? r1(sum('secs') / n / 60) : 0,
    firstTryPct: answers >= 5 ? Math.round(sum('first') / answers * 100) : null,
    soundsPerSession: n ? r1(sum('sounds') / n) : 0,
    boredomPerSession: n ? r1(sum('bored') / n) : 0,
    roundsPerSession: n ? r1(sum('rounds') / n) : 0
  };
}

export function judge(m, b) {
  const up = [], down = [], parts = [];
  const pct = (x, y) => (y ? Math.round((x - y) / y * 100) : 0);
  if (b.playMinPerSession > 0) {
    const d = pct(m.playMinPerSession, b.playMinPerSession);
    parts.push(`Play per session ${b.playMinPerSession} → ${m.playMinPerSession} min (${d >= 0 ? '+' : ''}${d}%)`);
    if (d >= 10) up.push('play'); else if (d <= -10) down.push('play');
  }
  if (m.firstTryPct != null && b.firstTryPct != null) {
    const d = m.firstTryPct - b.firstTryPct;
    parts.push(`first-try right ${b.firstTryPct}% → ${m.firstTryPct}%`);
    if (d >= 5) up.push('accuracy'); else if (d <= -5) down.push('accuracy');
  }
  if (m.soundsPerSession || b.soundsPerSession) {
    const d = m.soundsPerSession - b.soundsPerSession;
    parts.push(`sounds per session ${b.soundsPerSession} → ${m.soundsPerSession}`);
    if (d >= 0.3 && d >= b.soundsPerSession * 0.2) up.push('sounds'); else if (d <= -0.3 && -d >= b.soundsPerSession * 0.2) down.push('sounds');
  }
  if (m.boredomPerSession || b.boredomPerSession) {
    const d = m.boredomPerSession - b.boredomPerSession;
    parts.push(`lost-interest signals ${b.boredomPerSession} → ${m.boredomPerSession}`);
    if (d <= -0.3 && -d >= b.boredomPerSession * 0.25) up.push('attention'); else if (d >= 0.3 && d >= b.boredomPerSession * 0.25) down.push('attention');
  }
  const verdict = up.length && !down.length ? 'helped' : down.length && !up.length ? 'hurt' : up.length ? 'mixed' : 'no_change';
  return { verdict, summary: parts.join('; ') + (up.length || down.length ? `. Better: ${up.join(', ') || 'none'}. Worse: ${down.join(', ') || 'none'}.` : '.') };
}

if (process.argv[1]?.endsWith('scorecard.mjs')) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(FAMILY || '')) throw new Error('FAMILY required');
  const { versions, events } = await api(`/api/internal/scorecard?family=${FAMILY}&game=${GAME}`);
  const byV = {};
  for (const e of events) (byV[e.v] ||= []).push(e);
  const applied = versions.filter(v => v.status === 'live' && v.applied_at && v.parent_version);
  const outcomes = applied.map(v => {
    const m = metrics(byV[v.version]), b = metrics(byV[v.parent_version]);
    if (m.sessions < MIN_SESSIONS || b.sessions < MIN_SESSIONS)
      return { version: v.version, baseline: v.parent_version, verdict: 'too_early', summary: `Not enough play yet to judge (${m.sessions} sessions on v${v.version}, ${b.sessions} on v${v.parent_version}; needs ${MIN_SESSIONS} each).`, metrics: m, baselineMetrics: b };
    return { version: v.version, baseline: v.parent_version, ...judge(m, b), metrics: m, baselineMetrics: b };
  });
  await api('/api/internal/scorecard', { family: FAMILY, game: GAME, outcomes });
  const count = k => outcomes.filter(o => o.verdict === k).length;
  console.log(`Scorecard: ${outcomes.length} applied changes (${count('helped')} helped, ${count('hurt')} hurt, ${count('mixed')} mixed, ${count('no_change')} no change, ${count('too_early')} too early).`);
}
