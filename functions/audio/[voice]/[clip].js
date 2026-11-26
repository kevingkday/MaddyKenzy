// GET /audio/<voice>/<hash>.mp3 -> one spoken line in this family's voice (from D1)
import { familyFor } from '../../../lib/server.js';
export async function onRequestGet({ request, env, params }) {
  const family = await familyFor(request, env);
  const voice = String(params.voice || ''), hash = String(params.clip || '').replace(/\.mp3$/, '');
  if (!family || !/^[A-Za-z0-9]{8,40}$/.test(voice) || !/^[a-z0-9]{1,16}$/.test(hash)) return new Response('not found', { status: 404 });
  const row = await env.DB.prepare('SELECT mp3 FROM voice_clips WHERE family_id = ? AND voice_id = ? AND hash = ?').bind(family, voice, hash).first();
  if (!row) return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(new Uint8Array(row.mp3), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
}
