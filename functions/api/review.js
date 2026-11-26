// POST /api/review {pin, game} -> ask the improver to review recent play now (makes a proposal, changes nothing)
import { json, dispatch, grownup } from '../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game } = g;
  const busy = await env.DB.prepare("SELECT id FROM improve_runs WHERE family_id = ? AND game_id = ? AND status IN ('queued','running') AND created_at > unixepoch() - 1800").bind(family, game).first();
  if (busy) return json({ ok: true, run: busy.id, note: 'already running' });
  const run = await env.DB.prepare("INSERT INTO improve_runs (family_id, game_id, action) VALUES (?,?,'review') RETURNING id").bind(family, game).first();
  const err = await dispatch(env, { family, game, run: run.id, manual: true });
  if (err) {
    await env.DB.prepare("UPDATE improve_runs SET status = 'failed', message = ?, finished_at = unixepoch() WHERE id = ?").bind(err, run.id).run();
    return json({ error: `Could not start the review: ${err}.` }, 502);
  }
  return json({ ok: true, run: run.id });
}
