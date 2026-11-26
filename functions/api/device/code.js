// POST /api/device/code -> a short code (and link) to connect a kid's iPad/iPhone to this family (15 minutes)
import { json, sessionUser, sha256 } from '../../../lib/server.js';
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export async function onRequestPost({ request, env }) {
  const u = await sessionUser(request, env);
  if (!u?.family_id) return json({ error: 'Please sign in.' }, 401);
  const r = crypto.getRandomValues(new Uint8Array(8)), raw = [...r].map(x => ABC[x % ABC.length]).join('');
  const code = raw.slice(0, 4) + '-' + raw.slice(4);
  await env.DB.prepare("INSERT INTO links (token_hash, kind, family_id, created_by, expires_at) VALUES (?, 'device', ?, ?, ?)")
    .bind(await sha256(raw), u.family_id, u.id, Date.now() + 15 * 6e4).run();
  return json({ code, url: `${new URL(request.url).origin}/games/itsy-big-show/?link=${code}` });
}
