// GET /api/internal/context?family=&game=&run= -> everything the improver needs (token only)
import { json, slug, internalOk } from '../../../lib/server.js';
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const q = new URL(request.url).searchParams, family = slug(q.get('family')), game = slug(q.get('game'));
  const fg = await env.DB.prepare('SELECT * FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  if (!fg) return json({ error: 'unknown family/game' }, 404);
  const run = Number(q.get('run')) || 0;
  if (run) await env.DB.prepare("UPDATE improve_runs SET status = 'running', from_version = ? WHERE id = ? AND family_id = ?").bind(fg.active_version, run, family).run();
  const active = await env.DB.prepare('SELECT * FROM game_versions WHERE family_id = ? AND game_id = ? AND version = ?').bind(family, game, fg.active_version).first();
  const since = fg.last_review_at || 0;
  const { results: events } = await env.DB.prepare('SELECT t, session AS s, version AS v, activity AS a, type AS e, child_id AS c, data_json FROM events WHERE family_id = ? AND game_id = ? ORDER BY t DESC LIMIT 20000').bind(family, game).all();
  const { results: history } = await env.DB.prepare("SELECT version, changelog, notes_private, stats_json, status, undone, created_at FROM game_versions WHERE family_id = ? AND game_id = ? AND status IN ('live','proposed','dismissed') ORDER BY version DESC LIMIT 5").bind(family, game).all();
  const { results: children } = await env.DB.prepare('SELECT id, display_name, profile_private FROM children WHERE family_id = ?').bind(family).all();
  return json({
    family, game, active_version: fg.active_version, goals: fg.goals_private, children,
    config: JSON.parse(active.config_json), history, new_since_last: events.filter(e => e.t > since).length, since, upTo: events[0]?.t || 0,
    events: events.reverse().map(({ data_json, ...e }) => ({ ...e, ...(data_json ? JSON.parse(data_json) : {}) }))
  });
}
