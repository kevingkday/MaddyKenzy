// POST /api/auth/redeem {token} -> use a one-time invite or sign-in link; sets the parent's session cookie
import { json, sha256, randomToken, cookie } from '../../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const { token } = await request.json().catch(() => ({}));
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token || '')) return json({ error: 'That link is not valid.' }, 400);
  const h = await sha256(token), now = Date.now();
  const l = await env.DB.prepare("SELECT * FROM links WHERE token_hash = ? AND kind IN ('invite','login')").bind(h).first();
  if (!l || l.used_at || l.expires_at < now) return json({ error: 'That link has expired or was already used. Ask for a new one.' }, 410);
  let userId = l.user_id;
  const stmts = [env.DB.prepare('UPDATE links SET used_at = ? WHERE token_hash = ?').bind(now, h)];
  if (l.kind === 'invite') { userId = 'u_' + randomToken(9); stmts.push(env.DB.prepare("INSERT INTO users (id, family_id, role) VALUES (?, NULL, 'parent')").bind(userId)); }
  const session = randomToken(32), days = 365;
  stmts.push(env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').bind(await sha256(session), userId, now + days * 864e5));
  await env.DB.batch(stmts);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': cookie('mk_s', session, days * 86400) } });
}
