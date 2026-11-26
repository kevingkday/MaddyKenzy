// POST /api/apply {pin, game, version, kind?: "game" | "playbook"} -> make a waiting suggestion live
import { json, grownup } from '../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game, body } = g, v = Number(body.version) || 0, now = Date.now();
  if (body.kind === 'playbook') {
    const p = await env.DB.prepare("SELECT version FROM playbooks WHERE family_id = ? AND game_id = ? AND version = ? AND status = 'proposed'").bind(family, game, v).first();
    if (!p) return json({ error: 'That playbook update is no longer waiting.' }, 409);
    await env.DB.batch([
      env.DB.prepare("UPDATE playbooks SET status = 'superseded' WHERE family_id = ? AND game_id = ? AND status = 'live'").bind(family, game),
      env.DB.prepare("UPDATE playbooks SET status = 'live', applied_at = ? WHERE family_id = ? AND game_id = ? AND version = ?").bind(now, family, game, v)
    ]);
    return json({ ok: true, version: v });
  }
  const p = await env.DB.prepare("SELECT version FROM game_versions WHERE family_id = ? AND game_id = ? AND version = ? AND status = 'proposed'").bind(family, game, v).first();
  if (!p) return json({ error: 'That suggestion is no longer waiting.' }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE game_versions SET status = 'live', applied_at = ? WHERE family_id = ? AND game_id = ? AND version = ?").bind(now, family, game, v),
    env.DB.prepare('UPDATE family_games SET active_version = ? WHERE family_id = ? AND game_id = ?').bind(v, family, game)
  ]);
  return json({ ok: true, version: v });
}
