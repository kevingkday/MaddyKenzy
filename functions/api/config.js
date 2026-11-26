// GET /api/config?game=<id> -> this family's live config, and whether a review is waiting
import { json, slug, familyFor } from '../../lib/server.js';
export async function onRequestGet({ request, env }) {
  const game = slug(new URL(request.url).searchParams.get('game'));
  const family = await familyFor(request, env);
  if (!game || !family) return json({ error: 'unknown' }, 404);
  const row = await env.DB.prepare(`SELECT gv.version, gv.config_json FROM family_games fg
    JOIN game_versions gv ON gv.family_id = fg.family_id AND gv.game_id = fg.game_id AND gv.version = fg.active_version
    WHERE fg.family_id = ? AND fg.game_id = ?`).bind(family, game).first();
  if (!row) return json({ error: 'no config' }, 404);
  const pending = await env.DB.prepare("SELECT version FROM game_versions WHERE family_id = ? AND game_id = ? AND status = 'proposed' ORDER BY version DESC LIMIT 1").bind(family, game).first();
  const config = JSON.parse(row.config_json); config.version = row.version;
  return json({ version: row.version, config, pending: pending?.version || null });
}
