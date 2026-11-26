// POST /api/log {events:[...]} -> play events for this site's family
import { json, slug, familyFor, familyGame } from '../../lib/server.js';
const KNOWN = new Set(['t', 'g', 's', 'v', 'a', 'e', 'd', 'c']);
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const events = Array.isArray(body.events) ? body.events.slice(0, 500) : [];
  if (!events.length) return json({ ok: true, stored: 0 });
  const family = await familyFor(request, env);
  const game = slug(events[0].g);
  if (!family || !game || !(await familyGame(env, family, game))) return json({ error: 'unknown game' }, 404);
  const stmt = env.DB.prepare('INSERT INTO events (family_id, game_id, child_id, session, version, t, activity, type, data_json) VALUES (?,?,?,?,?,?,?,?,?)');
  const rows = events.filter(e => e && e.g === game && typeof e.e === 'string').map(e => {
    const data = Object.fromEntries(Object.entries(e).filter(([k]) => !KNOWN.has(k)));
    const d = JSON.stringify(data);
    return stmt.bind(family, game, slug(e.c), String(e.s || '').slice(0, 40), Number(e.v) || null, Number(e.t) || Date.now(),
      e.a ? String(e.a).slice(0, 40) : null, e.e.slice(0, 40), d.length > 2 ? d.slice(0, 2000) : null);
  });
  if (rows.length) await env.DB.batch(rows);
  return json({ ok: true, stored: rows.length });
}
