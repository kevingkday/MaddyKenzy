// POST /api/internal/propose -> save a tested config as a suggestion waiting for the parent (token only); notes are encrypted.
import { json, slug, internalOk } from '../../../lib/server.js';
import { familyKey } from '../../../lib/crypto.js';
import { saveProposal } from '../../../lib/context.js';
export async function onRequestPost({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const b = await request.json(), family = slug(b.family), game = slug(b.game);
  try { return json({ ok: true, version: await saveProposal(env, family, game, await familyKey(env, family), b) }); }
  catch (e) { return json({ error: e.message }, 400); }
}
