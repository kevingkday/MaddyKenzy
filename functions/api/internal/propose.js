// POST /api/internal/propose -> save a tested config as a suggestion waiting for the parent (token only)
import { json, slug, internalOk } from '../../../lib/server.js';
export async function onRequestPost({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const b = await request.json();
  const family = slug(b.family), game = slug(b.game);
  const fg = await env.DB.prepare('SELECT active_version FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  if (!fg || !b.config?.activities) return json({ error: 'bad request' }, 400);
  const max = await env.DB.prepare('SELECT max(version) AS v FROM game_versions WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  const version = (max?.v || 0) + 1;
  b.config.version = version;
  await env.DB.batch([
    env.DB.prepare("UPDATE game_versions SET status = 'superseded' WHERE family_id = ? AND game_id = ? AND status = 'proposed'").bind(family, game),
    env.DB.prepare("INSERT INTO game_versions (family_id, game_id, version, config_json, changelog, notes_private, stats_json, parent_version, created_by, status) VALUES (?,?,?,?,?,?,?,?,'improver','proposed')")
      .bind(family, game, version, JSON.stringify(b.config), String(b.changelog || '').slice(0, 300), String(b.notes || '').slice(0, 6000), JSON.stringify(b.stats || {}), fg.active_version),
    env.DB.prepare('UPDATE family_games SET last_review_at = ? WHERE family_id = ? AND game_id = ?').bind(Number(b.upTo) || Date.now(), family, game),
    env.DB.prepare("UPDATE improve_runs SET status = 'done', to_version = ?, message = 'A review is ready.', finished_at = unixepoch() WHERE id = ? AND family_id = ?").bind(version, Number(b.run) || 0, family)
  ]);
  return json({ ok: true, version });
}
