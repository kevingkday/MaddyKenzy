// Playbook rethink: the improver reads the scorecard of its own past changes and proposes
// new rules for how it reviews this family's game. The parent applies or dismisses them.
// Runs nightly when at least 3 changes have measured results since the last playbook
// (and it's been 3+ days), or on demand (FORCE=1). Logs print counts only.
//   FAMILY=maddykenzy GAME=itsy-big-show [FORCE=1] [RUN=id] node scripts/meta.mjs
import { api, askClaude } from './improve-api.mjs';
const FAMILY = process.env.FAMILY, GAME = process.env.GAME || 'itsy-big-show', RUN = process.env.RUN || '';
if (!/^[a-z0-9-]{1,40}$/.test(FAMILY || '') || !/^[a-z0-9-]{1,40}$/.test(GAME)) throw new Error('bad family/game');

const ctx = await api(`/api/internal/playbook?family=${FAMILY}&game=${GAME}&force=${process.env.FORCE ? 1 : 0}`);
if (!ctx.due) {
  console.log(`Playbook rethink not due (${ctx.fresh} new measured results; needs 3, and 3+ days since the last update).`);
  if (RUN) await api('/api/internal/run', { family: FAMILY, run: RUN, status: 'no_change', message: 'Not enough measured results yet to rethink the playbook.' });
  process.exit(0);
}
const measured = ctx.outcomes.filter(o => o.verdict !== 'too_early');

const SYSTEM = `You are the reviewer of a children's iPad game, and you keep a PLAYBOOK: the rules you follow when you suggest changes to this family's copy of the game.
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

const user = `FAMILY GOALS:\n${ctx.goals || 'none given'}\n\nCURRENT PLAYBOOK (v${ctx.live?.version || 1}):\n${ctx.live?.content || '(none)'}\n\nSCORECARD:\n${JSON.stringify(ctx.outcomes)}\n\nRECENT VERSIONS (newest first, with your notes when you suggested them):\n${JSON.stringify(ctx.versions)}\n\nPLAYBOOK UPDATES THE PARENT DISMISSED:\n${JSON.stringify(ctx.dismissed)}`;

const reply = await askClaude(SYSTEM, user);
const book = String(reply.playbook || '').trim(), why = String(reply.rationale_for_parent || '').trim();
const bullets = book.split('\n').filter(l => l.trim().startsWith('- ')).length;
if (bullets < 2 || book.length > 3000 || /https?:|<\w/i.test(book + why)) throw new Error('Rejected playbook: wrong shape');
const r = await api('/api/internal/playbook', { family: FAMILY, game: GAME, run: RUN, content: book, rationale: why, evidence: measured.length });
console.log(`Playbook update v${r.version} proposed from ${measured.length} measured results, waiting for the parent.`);
