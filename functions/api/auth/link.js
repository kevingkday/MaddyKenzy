// POST /api/auth/link {kind: "login" | "invite"} -> a one-time link
//   login:  sign yourself in on another device (30 minutes)
//   invite: (admin only) invite a new family to the beta (14 days)
import { json, sessionUser, randomToken, sha256 } from '../../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const u = await sessionUser(request, env);
  if (!u) return json({ error: 'Please sign in.' }, 401);
  const { kind } = await request.json().catch(() => ({}));
  if (kind === 'invite' && u.role !== 'admin') return json({ error: 'Only the admin can invite families.' }, 403);
  if (!['login', 'invite'].includes(kind)) return json({ error: 'Unknown link type.' }, 400);
  const token = randomToken(24), ttl = kind === 'invite' ? 14 * 864e5 : 30 * 6e4;
  await env.DB.prepare('INSERT INTO links (token_hash, kind, user_id, created_by, expires_at) VALUES (?,?,?,?,?)')
    .bind(await sha256(token), kind, kind === 'login' ? u.id : null, u.id, Date.now() + ttl).run();
  return json({ url: `${new URL(request.url).origin}/app/?t=${token}`, expires_in_minutes: ttl / 6e4 });
}
