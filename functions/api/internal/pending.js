// GET /api/internal/pending?min=20 -> family games with enough new play for the daily review.
// Opens a queued review run for each, so the grown-ups screen can show progress. (token only)
import { json, internalOk } from '../../../lib/server.js';
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const min = Number(new URL(request.url).searchParams.get('min')) || 20;
  const { results } = await env.DB.prepare(`SELECT fg.family_id AS family, fg.game_id AS game,
      (SELECT count(*) FROM events e WHERE e.family_id = fg.family_id AND e.game_id = fg.game_id AND e.t > coalesce(fg.last_review_at, 0)) AS fresh
    FROM family_games fg
    WHERE NOT EXISTS (SELECT 1 FROM improve_runs r WHERE r.family_id = fg.family_id AND r.game_id = fg.game_id AND r.status IN ('queued','running') AND r.created_at > unixepoch() - 1800)`).all();
  const due = results.filter(r => r.fresh >= min);
  for (const d of due) d.run = (await env.DB.prepare("INSERT INTO improve_runs (family_id, game_id, action) VALUES (?,?,'review') RETURNING id").bind(d.family, d.game).first()).id;
  return json({ due });
}
