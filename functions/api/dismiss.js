// POST /api/dismiss {pin, game, version} -> decline a proposal
import { json, grownup } from '../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game, body } = g;
  await env.DB.prepare("UPDATE game_versions SET status = 'dismissed' WHERE family_id = ? AND game_id = ? AND version = ? AND status = 'proposed'").bind(family, game, Number(body.version) || 0).run();
  return json({ ok: true });
}
