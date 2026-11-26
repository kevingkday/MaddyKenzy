// The improver's own playbook (token only).
// GET  ?family=&game=&force= -> is a rethink due, the live playbook, the scorecard, recent version notes, goals
// POST {family, game, run, content, rationale, evidence} -> save a proposed playbook for the parent
import { json, slug, internalOk } from '../../../lib/server.js';
export async function onRequestGet({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const q = new URL(request.url).searchParams, family = slug(q.get('family')), game = slug(q.get('game'));
  const live = await env.DB.prepare("SELECT version, content, applied_at FROM playbooks WHERE family_id = ? AND game_id = ? AND status = 'live'").bind(family, game).first();
  const proposed = await env.DB.prepare("SELECT version FROM playbooks WHERE family_id = ? AND game_id = ? AND status = 'proposed'").bind(family, game).first();
  const { results: outcomes } = await env.DB.prepare('SELECT version, baseline, verdict, summary, updated_at FROM version_outcomes WHERE family_id = ? AND game_id = ? ORDER BY version').bind(family, game).all();
  const { results: versions } = await env.DB.prepare('SELECT version, changelog, notes_private, status, undone FROM game_versions WHERE family_id = ? AND game_id = ? ORDER BY version DESC LIMIT 12').bind(family, game).all();
  const { results: dismissed } = await env.DB.prepare("SELECT version, rationale FROM playbooks WHERE family_id = ? AND game_id = ? AND status = 'dismissed' ORDER BY version DESC LIMIT 3").bind(family, game).all();
  const fg = await env.DB.prepare('SELECT goals_private FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  const since = live?.applied_at || 0;
  const fresh = outcomes.filter(o => o.verdict !== 'too_early' && o.updated_at * 1000 > since).length;
  const due = q.get('force') === '1' || (!proposed && fresh >= 3 && Date.now() - since > 3 * 864e5);
  return json({ due, fresh, live, outcomes, versions, dismissed, goals: fg?.goals_private || null });
}
export async function onRequestPost({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const b = await request.json(), family = slug(b.family), game = slug(b.game);
  if (!family || !game || !b.content) return json({ error: 'bad request' }, 400);
  const max = await env.DB.prepare('SELECT max(version) AS v FROM playbooks WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  const version = (max?.v || 0) + 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE playbooks SET status = 'superseded' WHERE family_id = ? AND game_id = ? AND status = 'proposed'").bind(family, game),
    env.DB.prepare("INSERT INTO playbooks (family_id, game_id, version, content, rationale, status, evidence) VALUES (?,?,?,?,?,'proposed',?)")
      .bind(family, game, version, String(b.content).slice(0, 4000), String(b.rationale || '').slice(0, 2000), Number(b.evidence) || 0),
    env.DB.prepare("UPDATE improve_runs SET status = 'done', message = 'A playbook update is ready.', finished_at = unixepoch() WHERE id = ? AND family_id = ?").bind(Number(b.run) || 0, family)
  ]);
  return json({ ok: true, version });
}
