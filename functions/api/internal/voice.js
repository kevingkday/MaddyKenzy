// Voice clips for the generator job (token only).
// GET  ?family=  -> family voice, children's first names, clips already made, lines that fell back to the iPad voice, live config
// POST ?family=&voice=&hash=  (body: mp3 bytes, header x-text: the line) -> store a clip
import { json, slug, internalOk } from '../../../lib/server.js';
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const family = slug(new URL(request.url).searchParams.get('family'));
  const f = await env.DB.prepare('SELECT voice_id FROM families WHERE id = ?').bind(family).first();
  if (!f) return json({ error: 'unknown family' }, 404);
  const voice = f.voice_id || env.ELEVENLABS_VOICE_ID || null;
  const { results: kids } = await env.DB.prepare('SELECT display_name FROM children WHERE family_id = ?').bind(family).all();
  const { results: have } = voice ? await env.DB.prepare('SELECT hash FROM voice_clips WHERE family_id = ? AND voice_id = ?').bind(family, voice).all() : { results: [] };
  const { results: misses } = await env.DB.prepare("SELECT DISTINCT json_extract(data_json, '$.text') AS text FROM events WHERE family_id = ? AND type = 'tts_miss' AND t > ? LIMIT 2000").bind(family, Date.now() - 60 * 864e5).all();
  const { results: configs } = await env.DB.prepare(`SELECT gv.game_id, gv.config_json FROM family_games fg JOIN game_versions gv
    ON gv.family_id = fg.family_id AND gv.game_id = fg.game_id AND gv.version = fg.active_version WHERE fg.family_id = ?`).bind(family).all();
  return json({ family, voice, children: kids.map(k => k.display_name), have: have.map(h => h.hash), misses: misses.map(m => m.text).filter(Boolean),
    configs: Object.fromEntries(configs.map(c => [c.game_id, JSON.parse(c.config_json)])) });
}
export async function onRequestPost({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const q = new URL(request.url).searchParams, family = slug(q.get('family')), voice = q.get('voice') || '', hash = q.get('hash') || '';
  if (!family || !/^[A-Za-z0-9]{8,40}$/.test(voice) || !/^[a-z0-9]{1,16}$/.test(hash)) return json({ error: 'bad request' }, 400);
  const mp3 = await request.arrayBuffer();
  if (!mp3.byteLength || mp3.byteLength > 900000) return json({ error: 'bad audio' }, 400);
  const text = decodeURIComponent(request.headers.get('x-text') || '').slice(0, 300);
  await env.DB.prepare('INSERT OR REPLACE INTO voice_clips (family_id, voice_id, hash, text, mp3) VALUES (?,?,?,?,?)').bind(family, voice, hash, text, mp3).run();
  return json({ ok: true, bytes: mp3.byteLength });
}
