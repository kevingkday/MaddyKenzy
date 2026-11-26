// GET /api/internal/families -> every family game (token only)
import { json, internalOk } from '../../../lib/server.js';
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const { results } = await env.DB.prepare('SELECT family_id AS family, game_id AS game FROM family_games').all();
  return json({ games: results });
}
