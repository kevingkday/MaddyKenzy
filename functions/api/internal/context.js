// GET /api/internal/context?family=&game=&run= -> everything the nightly reviewer needs, decrypted (token only).
// Private-mode families are never returned: their notes can only be unlocked by the parent.
import { json, slug, internalOk } from '../../../lib/server.js';
import { familyKey } from '../../../lib/crypto.js';
import { reviewContext } from '../../../lib/context.js';
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const q = new URL(request.url).searchParams, family = slug(q.get('family')), game = slug(q.get('game'));
  const f = await env.DB.prepare('SELECT private_mode FROM families WHERE id = ?').bind(family).first();
  if (!f) return json({ error: 'unknown family/game' }, 404);
  if (f.private_mode) return json({ error: 'private family' }, 403);
  const ctx = await reviewContext(env, family, game, await familyKey(env, family), Number(q.get('run')) || 0);
  return ctx ? json(ctx) : json({ error: 'unknown family/game' }, 404);
}
