// POST /api/undo {pin, game} -> go back to the previous live version
import { json, grownup } from '../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game } = g;
  const fg = await env.DB.prepare('SELECT active_version FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  const prev = await env.DB.prepare("SELECT version FROM game_versions WHERE family_id = ? AND game_id = ? AND version < ? AND status = 'live' AND undone = 0 ORDER BY version DESC LIMIT 1").bind(family, game, fg.active_version).first();
  if (!prev) return json({ ok: true, changed: false, message: 'Nothing to undo.' });
  await env.DB.batch([
    env.DB.prepare('UPDATE game_versions SET undone = 1 WHERE family_id = ? AND game_id = ? AND version = ?').bind(family, game, fg.active_version),
    env.DB.prepare('UPDATE family_games SET active_version = ? WHERE family_id = ? AND game_id = ?').bind(prev.version, family, game)
  ]);
  return json({ ok: true, changed: true, version: prev.version });
}
