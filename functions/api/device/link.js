// POST /api/device/link {code} -> connects this device to the family; returns the device token the game keeps
import { json, sha256, randomToken } from '../../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const { code } = await request.json().catch(() => ({}));
  const raw = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 8) return json({ error: 'That code should be 8 letters and numbers.' }, 400);
  const h = await sha256(raw), now = Date.now();
  const l = await env.DB.prepare("SELECT * FROM links WHERE token_hash = ? AND kind = 'device'").bind(h).first();
  if (!l || l.used_at || l.expires_at < now) return json({ error: 'That code has expired or was already used. Make a new one in the parent dashboard.' }, 410);
  const token = randomToken(32), id = 'd_' + randomToken(9);
  await env.DB.batch([
    env.DB.prepare('UPDATE links SET used_at = ? WHERE token_hash = ?').bind(now, h),
    env.DB.prepare('INSERT INTO devices (id, family_id, label, token_hash, last_seen) VALUES (?,?,?,?,?)').bind(id, l.family_id, String(request.headers.get('user-agent') || '').slice(0, 60), await sha256(token), now)
  ]);
  return json({ ok: true, token });
}
