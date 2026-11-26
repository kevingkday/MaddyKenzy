// POST /api/apply {pin, game, version} -> make a reviewed proposal the live game
import { json, grownup } from '../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game, body } = g, v = Number(body.version) || 0;
  const p = await env.DB.prepare("SELECT version FROM game_versions WHERE family_id = ? AND game_id = ? AND version = ? AND status = 'proposed'").bind(family, game, v).first();
  if (!p) return json({ error: 'That suggestion is no longer waiting.' }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE game_versions SET status = 'live' WHERE family_id = ? AND game_id = ? AND version = ?").bind(family, game, v),
    env.DB.prepare('UPDATE family_games SET active_version = ? WHERE family_id = ? AND game_id = ?').bind(v, family, game)
  ]);
  return json({ ok: true, version: v });
}
