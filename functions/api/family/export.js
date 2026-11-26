// GET /api/family/export -> download everything stored about this family (decrypted in standard mode;
// in private mode the private fields stay encrypted, since only the parent's passphrase can open them)
import { json, sessionUser } from '../../../lib/server.js';
import { familyKey, dec } from '../../../lib/crypto.js';
export async function onRequestGet({ request, env }) {
  const u = await sessionUser(request, env);
  if (!u?.family_id) return json({ error: 'Please sign in.' }, 401);
  const f = u.family_id, fam = await env.DB.prepare('SELECT id, name, private_mode, created_at FROM families WHERE id = ?').bind(f).first();
  const key = fam.private_mode ? null : await familyKey(env, f), d = async s => fam.private_mode ? s : await dec(key, s);
  const all = async (sql) => (await env.DB.prepare(sql).bind(f).all()).results;
  const children = await all('SELECT id, display_name, profile_private, label, age, created_at FROM children WHERE family_id = ?');
  for (const c of children) { c.display_name = await d(c.display_name); c.profile_private = await d(c.profile_private); }
  const games = await all('SELECT game_id, active_version, goals_private FROM family_games WHERE family_id = ?');
  for (const g of games) g.goals_private = await d(g.goals_private);
  const versions = await all('SELECT game_id, version, status, changelog, notes_private, config_json, created_at, applied_at FROM game_versions WHERE family_id = ?');
  for (const v of versions) v.notes_private = await d(v.notes_private);
  const playbooks = await all('SELECT game_id, version, status, content, rationale, created_at FROM playbooks WHERE family_id = ?');
  for (const p of playbooks) { p.content = await d(p.content); p.rationale = await d(p.rationale); }
  const out = {
    exported_at: new Date().toISOString(), family: { ...fam, name: await d(fam.name) }, private_mode_note: fam.private_mode ? 'Private mode: names and notes are encrypted with your passphrase.' : undefined,
    children, games, versions, playbooks,
    scorecard: await all('SELECT game_id, version, baseline, verdict, summary FROM version_outcomes WHERE family_id = ?'),
    devices: await all('SELECT id, label, created_at, last_seen FROM devices WHERE family_id = ?'),
    events: await all('SELECT game_id, child_id, session, version, t, activity, type, data_json FROM events WHERE family_id = ? ORDER BY t')
  };
  return new Response(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="our-game-data.json"', 'cache-control': 'no-store' } });
}
