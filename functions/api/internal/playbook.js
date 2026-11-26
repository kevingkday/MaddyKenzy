// The improver's own playbook (token only; private-mode families excluded).
// GET  ?family=&game=&force= -> is a rethink due, the live playbook, the scorecard, recent version notes, goals (decrypted)
// POST {family, game, run, content, rationale, evidence} -> save a proposed playbook (encrypted)
import { json, slug, internalOk } from '../../../lib/server.js';
import { familyKey } from '../../../lib/crypto.js';
import { metaContext, savePlaybook } from '../../../lib/context.js';
async function check(env, family) {
  const f = await env.DB.prepare('SELECT private_mode FROM families WHERE id = ?').bind(family).first();
  return !f ? json({ error: 'unknown family' }, 404) : f.private_mode ? json({ error: 'private family' }, 403) : null;
}
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const q = new URL(request.url).searchParams, family = slug(q.get('family')), game = slug(q.get('game'));
  const bad = await check(env, family); if (bad) return bad;
  return json(await metaContext(env, family, game, await familyKey(env, family), q.get('force') === '1'));
}
export async function onRequestPost({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const b = await request.json(), family = slug(b.family), game = slug(b.game);
  const bad = await check(env, family); if (bad) return bad;
  if (!game || !b.content) return json({ error: 'bad request' }, 400);
  return json({ ok: true, version: await savePlaybook(env, family, game, await familyKey(env, family), b) });
}
