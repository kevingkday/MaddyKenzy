// Reading a family's data for the reviewer, and saving what it suggests, with encryption handled here.
// `key` is the family's AES key (from lib/crypto familyKey); private text is decrypted on read and encrypted on write.
import { dec, enc } from './crypto.js';

export async function reviewContext(env, family, game, key, run) {
  const fg = await env.DB.prepare('SELECT * FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  if (!fg) return null;
  if (run) await env.DB.prepare("UPDATE improve_runs SET status = 'running', from_version = ? WHERE id = ? AND family_id = ?").bind(fg.active_version, run, family).run();
  const active = await env.DB.prepare('SELECT * FROM game_versions WHERE family_id = ? AND game_id = ? AND version = ?').bind(family, game, fg.active_version).first();
  const since = fg.last_review_at || 0;
  const { results: events } = await env.DB.prepare('SELECT t, session AS s, version AS v, activity AS a, type AS e, child_id AS c, data_json FROM events WHERE family_id = ? AND game_id = ? ORDER BY t DESC LIMIT 20000').bind(family, game).all();
  const { results: history } = await env.DB.prepare("SELECT version, changelog, notes_private, stats_json, status, undone, created_at FROM game_versions WHERE family_id = ? AND game_id = ? AND status IN ('live','proposed','dismissed') ORDER BY version DESC LIMIT 5").bind(family, game).all();
  const { results: outcomes } = await env.DB.prepare('SELECT version, baseline, verdict, summary FROM version_outcomes WHERE family_id = ? AND game_id = ? ORDER BY version').bind(family, game).all();
  const pb = await env.DB.prepare("SELECT version, content FROM playbooks WHERE family_id = ? AND game_id = ? AND status = 'live'").bind(family, game).first();
  const { results: kids } = await env.DB.prepare('SELECT id, display_name, profile_private, age FROM children WHERE family_id = ?').bind(family).all();
  for (const h of history) h.notes_private = await dec(key, h.notes_private);
  const children = [];
  for (const k of kids) children.push({ id: k.id, name: await dec(key, k.display_name), age: k.age, profile: await dec(key, k.profile_private) });
  return {
    family, game, active_version: fg.active_version, goals: await dec(key, fg.goals_private || (await env.DB.prepare('SELECT goals_private FROM family_games WHERE family_id = ? AND goals_private IS NOT NULL LIMIT 1').bind(family).first())?.goals_private), children,
    config: JSON.parse(active.config_json), history, outcomes, playbook: pb ? { version: pb.version, content: await dec(key, pb.content) } : null,
    new_since_last: events.filter(e => e.t > since).length, since, upTo: events[0]?.t || 0,
    events: events.reverse().map(({ data_json, ...e }) => ({ ...e, ...(data_json ? JSON.parse(data_json) : {}) }))
  };
}

export async function saveProposal(env, family, game, key, b) {
  const fg = await env.DB.prepare('SELECT active_version FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  if (!fg || !b.config || typeof b.config !== 'object' || Array.isArray(b.config)) throw new Error('bad proposal');
  const max = await env.DB.prepare('SELECT max(version) AS v FROM game_versions WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  const version = (max?.v || 0) + 1;
  b.config.version = version;
  await env.DB.batch([
    env.DB.prepare("UPDATE game_versions SET status = 'superseded' WHERE family_id = ? AND game_id = ? AND status = 'proposed'").bind(family, game),
    env.DB.prepare("INSERT INTO game_versions (family_id, game_id, version, config_json, changelog, notes_private, stats_json, parent_version, created_by, status) VALUES (?,?,?,?,?,?,?,?,'improver','proposed')")
      .bind(family, game, version, JSON.stringify(b.config), String(b.changelog || '').slice(0, 300), await enc(key, String(b.notes || '').slice(0, 6000)), JSON.stringify(b.stats || {}), fg.active_version),
    env.DB.prepare('UPDATE family_games SET last_review_at = ? WHERE family_id = ? AND game_id = ?').bind(Number(b.upTo) || Date.now(), family, game),
    env.DB.prepare("UPDATE improve_runs SET status = 'done', to_version = ?, message = 'A review is ready.', finished_at = unixepoch() WHERE id = ? AND family_id = ?").bind(version, Number(b.run) || 0, family)
  ]);
  return version;
}

export async function metaContext(env, family, game, key, force) {
  const live = await env.DB.prepare("SELECT version, content, applied_at FROM playbooks WHERE family_id = ? AND game_id = ? AND status = 'live'").bind(family, game).first();
  const proposed = await env.DB.prepare("SELECT version FROM playbooks WHERE family_id = ? AND game_id = ? AND status = 'proposed'").bind(family, game).first();
  const { results: outcomes } = await env.DB.prepare('SELECT version, baseline, verdict, summary, updated_at FROM version_outcomes WHERE family_id = ? AND game_id = ? ORDER BY version').bind(family, game).all();
  const { results: versions } = await env.DB.prepare('SELECT version, changelog, notes_private, status, undone FROM game_versions WHERE family_id = ? AND game_id = ? ORDER BY version DESC LIMIT 12').bind(family, game).all();
  const { results: dismissed } = await env.DB.prepare("SELECT version, rationale FROM playbooks WHERE family_id = ? AND game_id = ? AND status = 'dismissed' ORDER BY version DESC LIMIT 3").bind(family, game).all();
  const fg = await env.DB.prepare('SELECT goals_private FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first()
    || await env.DB.prepare('SELECT goals_private FROM family_games WHERE family_id = ? AND goals_private IS NOT NULL LIMIT 1').bind(family).first();
  for (const v of versions) v.notes_private = await dec(key, v.notes_private);
  for (const d of dismissed) d.rationale = await dec(key, d.rationale);
  const since = live?.applied_at || 0;
  const fresh = outcomes.filter(o => o.verdict !== 'too_early' && o.updated_at * 1000 > since).length;
  const due = !!force || (!proposed && fresh >= 3 && Date.now() - since > 3 * 864e5);
  return { due, fresh, live: live ? { ...live, content: await dec(key, live.content) } : null, outcomes, versions, dismissed, goals: await dec(key, fg?.goals_private) };
}

export async function savePlaybook(env, family, game, key, b) {
  const max = await env.DB.prepare('SELECT max(version) AS v FROM playbooks WHERE family_id = ? AND game_id = ?').bind(family, game).first();
  const version = (max?.v || 0) + 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE playbooks SET status = 'superseded' WHERE family_id = ? AND game_id = ? AND status = 'proposed'").bind(family, game),
    env.DB.prepare("INSERT INTO playbooks (family_id, game_id, version, content, rationale, status, evidence) VALUES (?,?,?,?,?,'proposed',?)")
      .bind(family, game, version, await enc(key, String(b.content).slice(0, 4000)), await enc(key, String(b.rationale || '').slice(0, 2000)), Number(b.evidence) || 0),
    env.DB.prepare("UPDATE improve_runs SET status = 'done', message = 'A playbook update is ready.', finished_at = unixepoch() WHERE id = ? AND family_id = ?").bind(Number(b.run) || 0, family)
  ]);
  return version;
}
