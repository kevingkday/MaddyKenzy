// GET /api/status?game=<id>&run=<id> -> progress of an improve/undo run
import { json, slug, familyFor } from '../../lib/server.js';
export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams, family = await familyFor(request, env), game = slug(q.get('game'));
  const row = await env.DB.prepare('SELECT id, action, status, message, from_version, to_version FROM improve_runs WHERE family_id = ? AND game_id = ? AND id = ?')
    .bind(family, game, Number(q.get('run')) || 0).first();
  return row ? json(row) : json({ error: 'not found' }, 404);
}
