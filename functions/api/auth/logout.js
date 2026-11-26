// POST /api/auth/logout
import { json, sha256, cookie } from '../../../lib/server.js';
export async function onRequestPost({ request, env }) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)mk_s=([A-Za-z0-9_-]{20,})/);
  if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run();
  return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'set-cookie': cookie('mk_s', '', 0) } });
}
