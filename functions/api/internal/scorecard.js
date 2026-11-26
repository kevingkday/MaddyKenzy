// Scorecard data (token only).
// GET  ?family=&game= -> versions and compact play events (last 90 days)
// POST {family, game, outcomes:[{version, baseline, verdict, summary, metrics, baselineMetrics}]} -> save
import { json, slug, internalOk } from '../../../lib/server.js';
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const q = new URL(request.url).searchParams, family = slug(q.get('family')), game = slug(q.get('game'));
  const { results: versions } = await env.DB.prepare('SELECT version, parent_version, status, undone, changelog, applied_at FROM game_versions WHERE family_id = ? AND game_id = ? ORDER BY version').bind(family, game).all();
  const { results: events } = await env.DB.prepare(`SELECT t, session AS s, version AS v, activity AS a, type AS e, child_id AS c,
      json_extract(data_json,'$.ok') AS ok, json_extract(data_json,'$.first') AS first, json_extract(data_json,'$.secs') AS secs
    FROM events WHERE family_id = ? AND game_id = ? AND t > ? ORDER BY t LIMIT 60000`).bind(family, game, Date.now() - 90 * 864e5).all();
  return json({ versions, events });
}
export async function onRequestPost({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const b = await request.json(), family = slug(b.family), game = slug(b.game);
  const stmt = env.DB.prepare(`INSERT INTO version_outcomes (family_id, game_id, version, baseline, verdict, summary, metrics_json, baseline_json, updated_at)
    VALUES (?,?,?,?,?,?,?,?,unixepoch()) ON CONFLICT (family_id, game_id, version) DO UPDATE SET baseline = excluded.baseline, verdict = excluded.verdict,
    summary = excluded.summary, metrics_json = excluded.metrics_json, baseline_json = excluded.baseline_json, updated_at = unixepoch()`);
  const rows = (b.outcomes || []).map(o => stmt.bind(family, game, Number(o.version), o.baseline ?? null, String(o.verdict), String(o.summary || '').slice(0, 500), JSON.stringify(o.metrics || {}), JSON.stringify(o.baselineMetrics || {})));
  if (rows.length) await env.DB.batch(rows);
  return json({ ok: true, saved: rows.length });
}
