// GET /api/internal/families -> every family game (token only)
import { json, internalOk } from '../../../lib/server.js';
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const { results } = await env.DB.prepare('SELECT fg.family_id AS family, fg.game_id AS game, f.private_mode AS private FROM family_games fg JOIN families f ON f.id = fg.family_id').all();
  return json({ games: results });
}
