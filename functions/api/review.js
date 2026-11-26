// POST /api/review {pin? | signed in, game, kind?: "review" | "meta", dek?}
// Standard families: queue the review (or playbook rethink) on GitHub; it saves a suggestion, changes nothing.
// Private-mode families: the parent's browser sends the unlocked family key, and the review runs right here,
// inside this request, so their notes are never readable anywhere else. Nothing is stored unencrypted.
import { json, dispatch, grownup } from '../../lib/server.js';
import { familyKey, dec } from '../../lib/crypto.js';
import { reviewContext, saveProposal, metaContext, savePlaybook } from '../../lib/context.js';
import { reviewPrompt, validate, callClaude, META_SYSTEM, metaPrompt, checkPlaybook } from '../../lib/review.js';

export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game, body } = g, kind = body.kind === 'meta' ? 'meta' : 'review';
  const busy = await env.DB.prepare("SELECT id FROM improve_runs WHERE family_id = ? AND game_id = ? AND status IN ('queued','running') AND created_at > unixepoch() - 1800").bind(family, game).first();
  if (busy) return json({ ok: true, run: busy.id, note: 'already running' });
  const f = await env.DB.prepare('SELECT name, private_mode FROM families WHERE id = ?').bind(family).first();
  const run = (await env.DB.prepare("INSERT INTO improve_runs (family_id, game_id, action) VALUES (?,?,?) RETURNING id").bind(family, game, kind).first()).id;
  const end = async (status, message) => { await env.DB.prepare('UPDATE improve_runs SET status = ?, message = ?, finished_at = unixepoch() WHERE id = ?').bind(status, message, run).run(); return json({ ok: true, run, status, message }); };

  if (!f.private_mode) {
    const err = await dispatch(env, { family, game, run, manual: true, kind });
    return err ? end('failed', `Could not start: ${err}.`) : json({ ok: true, run });
  }

  // private mode: run here with the key the parent just unlocked
  if (!body.dek) return end('failed', 'Private mode: open the parent dashboard and unlock with your passphrase to review.');
  const key = await familyKey(env, family, body.dek);
  if ((await dec(key, f.name)) == null) return end('failed', 'Wrong passphrase.');
  const opts = { apiKey: env.ANTHROPIC_API_KEY, model: env.MODEL };
  try {
    if (kind === 'meta') {
      const ctx = await metaContext(env, family, game, key, true);
      const { book, why } = checkPlaybook(await callClaude({ ...opts, mock: env.MOCK_CLAUDE_META }, META_SYSTEM, metaPrompt(ctx), 3000));
      await savePlaybook(env, family, game, key, { content: book, rationale: why, evidence: ctx.outcomes.filter(o => o.verdict !== 'too_early').length, run });
      return json({ ok: true, run, status: 'done' });
    }
    const ctx = await reviewContext(env, family, game, key, run);
    if (ctx.new_since_last < 5) return end('no_change', `Not enough new play to review yet (${ctx.new_since_last} new events, need 5).`);
    const { system, user, summary } = reviewPrompt(ctx, game);
    const reply = await callClaude({ ...opts, mock: env.MOCK_CLAUDE_REVIEW }, system, user);
    const errs = validate(reply.config || {}, ctx.config);
    if (errs.length) return end('failed', 'The suggestion did not pass its checks, so nothing changed.');
    const version = await saveProposal(env, family, game, key, { config: reply.config, changelog: String(reply.changelog || 'Tuned the game').slice(0, 200), notes: String(reply.notes_for_parent || ''),
      stats: { sessions: summary.sessions, medianSessionMinutes: summary.medianSessionMinutes, byVersion: summary.byVersion }, upTo: ctx.upTo, run });
    return json({ ok: true, run, status: 'done', version });
  } catch (e) { return end('failed', 'The review could not finish. Nothing changed.'); }
}
