// POST /api/notes {pin? | signed in, game, dek?} -> waiting suggestion (with notes), history, scorecard, playbook.
// Private-mode families: notes come back only when the parent's browser sends their unlocked key (dek); otherwise just the numbers.
import { json, grownup } from '../../lib/server.js';
import { familyKey, dec } from '../../lib/crypto.js';
export async function onRequestPost({ request, env }) {
  const g = await grownup(request, env); if (g instanceof Response) return g;
  const { family, game, body } = g;
  const f = await env.DB.prepare('SELECT name, private_mode FROM families WHERE id = ?').bind(family).first();
  let key = null, locked = false;
  if (f.private_mode) {
    if (body.dek) { key = await familyKey(env, family, body.dek); if ((await dec(key, f.name)) == null) return json({ error: 'Wrong passphrase.' }, 403); }
    else locked = true;
  } else key = await familyKey(env, family);
  const d = async s => locked ? null : await dec(key, s);
  const { results } = await env.DB.prepare(`SELECT version, changelog, notes_private, status, undone, created_at FROM game_versions
    WHERE family_id = ? AND game_id = ? AND status IN ('proposed','live') ORDER BY version DESC LIMIT 20`).bind(family, game).all();
  for (const v of results) v.notes_private = await d(v.notes_private);
  const fg = await env.DB.prepare('SELECT active_version, last_review_at FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  const fresh = await env.DB.prepare('SELECT count(*) AS n FROM events WHERE family_id = ? AND game_id = ? AND t > ?').bind(family, game, fg.last_review_at || 0).first();
  const { results: outcomes } = await env.DB.prepare('SELECT version, baseline, verdict, summary FROM version_outcomes WHERE family_id = ? AND game_id = ? ORDER BY version DESC LIMIT 20').bind(family, game).all();
  const { results: books } = await env.DB.prepare("SELECT version, content, rationale, status, evidence, applied_at FROM playbooks WHERE family_id = ? AND game_id = ? AND status IN ('live','proposed') ORDER BY version DESC").bind(family, game).all();
  for (const b of books) { b.content = await d(b.content); b.rationale = await d(b.rationale); }
  return json({ private: !!f.private_mode, locked, active: fg.active_version, pending: results.find(v => v.status === 'proposed') || null, history: results.filter(v => v.status === 'live'),
    newEvents: fresh.n, outcomes, playbook: books.find(b => b.status === 'live') || null, playbookPending: books.find(b => b.status === 'proposed') || null });
}
