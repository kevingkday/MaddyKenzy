// POST /api/dismiss {pin, game, version, kind?: "game" | "playbook"} -> decline a suggestion
import { json, grownup } from '../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game, body } = g, table = body.kind === 'playbook' ? 'playbooks' : 'game_versions';
  await env.DB.prepare(`UPDATE ${table} SET status = 'dismissed' WHERE family_id = ? AND game_id = ? AND version = ? AND status = 'proposed'`).bind(family, game, Number(body.version) || 0).run();
  return json({ ok: true });
}
