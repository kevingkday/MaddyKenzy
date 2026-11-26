// Playbook rethink: the improver reads the scorecard of its own past changes and proposes new rules for
// how it reviews this family's game (lib/review.js META_SYSTEM). The parent applies or dismisses them.
// Nightly when at least 3 changes have measured results since the last playbook (and 3+ days), or on demand (FORCE=1).
//   FAMILY=maddykenzy GAME=itsy-big-show [FORCE=1] [RUN=id] node scripts/meta.mjs
import { api, claudeOpts } from './improve-api.mjs';
import { META_SYSTEM, metaPrompt, checkPlaybook, callClaude } from '../lib/review.js';
const FAMILY = process.env.FAMILY, GAME = process.env.GAME || 'itsy-big-show', RUN = process.env.RUN || '';
if (!/^[A-Za-z0-9_-]{1,40}$/.test(FAMILY || '') || !/^[A-Za-z0-9_-]{1,40}$/.test(GAME)) throw new Error('bad family/game');

const ctx = await api(`/api/internal/playbook?family=${FAMILY}&game=${GAME}&force=${process.env.FORCE ? 1 : 0}`);
if (!ctx.due) {
  console.log(`Playbook rethink not due (${ctx.fresh} new measured results; needs 3, and 3+ days since the last update).`);
  if (RUN) await api('/api/internal/run', { family: FAMILY, run: RUN, status: 'no_change', message: 'Not enough measured results yet to rethink the playbook.' });
  process.exit(0);
}
const measured = ctx.outcomes.filter(o => o.verdict !== 'too_early');
const { book, why } = checkPlaybook(await callClaude(claudeOpts(), META_SYSTEM, metaPrompt(ctx), 3000));
const r = await api('/api/internal/playbook', { family: FAMILY, game: GAME, run: RUN, content: book, rationale: why, evidence: measured.length });
console.log(`Playbook update v${r.version} proposed from ${measured.length} measured results, waiting for the parent.`);
