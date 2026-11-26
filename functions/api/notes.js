// POST /api/notes {pin, game} -> waiting suggestion (with its notes) and the private change history
import { json, grownup } from '../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game } = g;
  const { results } = await env.DB.prepare(`SELECT version, changelog, notes_private, status, undone, created_at FROM game_versions
    WHERE family_id = ? AND game_id = ? AND status IN ('proposed','live') ORDER BY version DESC LIMIT 20`).bind(family, game).all();
  const fg = await env.DB.prepare('SELECT active_version, last_review_at FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  const fresh = await env.DB.prepare('SELECT count(*) AS n FROM events WHERE family_id = ? AND game_id = ? AND t > ?').bind(family, game, fg.last_review_at || 0).first();
  return json({ active: fg.active_version, pending: results.find(v => v.status === 'proposed') || null, history: results.filter(v => v.status === 'live'), newEvents: fresh.n });
}
