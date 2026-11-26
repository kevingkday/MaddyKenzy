// The signed-in parent's family.
// GET    -> family, children, goals, linked devices (decrypted; in private mode the browser decrypts with the parent's passphrase)
// POST   -> create the family and its first, AI-tailored game (onboarding)
// DELETE {confirm: "DELETE"} -> erase the family and everything about it
import { json, sessionUser, randomToken, sha256 } from '../../../lib/server.js';
import { familyKey, newDek, lockWithMaster, masterReady, enc, dec, b64 } from '../../../lib/crypto.js';
import { STARTER_PLAYBOOK, STARTER_SYSTEM, starterPrompt, validate, callClaude } from '../../../lib/review.js';
import itsyDefault from '../../../site/games/itsy-big-show/game.json';

export async function onRequestGet({ request, env }) {
  const u = await sessionUser(request, env);
  if (!u) return json({ error: 'Please sign in.' }, 401);
  if (!u.family_id) return json({ family: null, role: u.role });
  const f = await env.DB.prepare('SELECT id, name, private_mode, dek_pass_wrapped, pass_salt FROM families WHERE id = ?').bind(u.family_id).first();
  const key = f.private_mode ? null : await familyKey(env, f.id);
  const show = async s => f.private_mode ? s : await dec(key, s); // private mode: ciphertext goes to the browser to decrypt
  const { results: kids } = await env.DB.prepare('SELECT id, display_name, profile_private, label, age FROM children WHERE family_id = ? ORDER BY created_at').bind(f.id).all();
  const fg = await env.DB.prepare("SELECT goals_private, active_version FROM family_games WHERE family_id = ? AND game_id = 'itsy-big-show'").bind(f.id).first();
  const { results: devices } = await env.DB.prepare('SELECT id, label, created_at, last_seen FROM devices WHERE family_id = ? ORDER BY created_at DESC').bind(f.id).all();
  const children = [];
  for (const k of kids) children.push({ id: k.id, label: k.label, age: k.age, name: await show(k.display_name), profile: await show(k.profile_private) });
  return json({
    role: u.role,
    family: { id: f.id, name: await show(f.name), private_mode: !!f.private_mode, dek_pass_wrapped: f.dek_pass_wrapped, pass_salt: f.pass_salt },
    children, goals: fg ? await show(fg.goals_private) : null, version: fg?.active_version, devices
  });
}

export async function onRequestPost({ request, env }) {
  const u = await sessionUser(request, env);
  if (!u) return json({ error: 'Please sign in.' }, 401);
  if (u.family_id) return json({ error: 'Your family is already set up.' }, 409);
  const b = await request.json().catch(() => ({}));
  const kids = (Array.isArray(b.children) ? b.children : []).slice(0, 6).filter(k => String(k.name || '').trim());
  if (!String(b.name || '').trim() || !kids.length) return json({ error: 'Add a family name and at least one child.' }, 400);
  if (!/^\d{4,8}$/.test(String(b.pin || ''))) return json({ error: 'The grown-ups PIN should be 4 to 8 digits.' }, 400);
  if (b.image && (typeof b.image !== 'string' || b.image.length > 2_000_000)) return json({ error: 'That picture is too large.' }, 400);

  // the family's own key
  let key, dekWrapped = null, passWrapped = null, passSalt = null;
  if (b.private) {
    if (!b.private.dek || !b.private.wrapped || !b.private.salt) return json({ error: 'Private mode needs a passphrase.' }, 400);
    key = await familyKey(env, null, b.private.dek); passWrapped = String(b.private.wrapped); passSalt = String(b.private.salt);
  } else {
    if (!masterReady(env)) return json({ error: 'Encryption is not configured on the server yet (MASTER_KEY).' }, 503);
    const dek = newDek(); dekWrapped = await lockWithMaster(env, dek);
    key = await familyKey(env, null, b64(dek));
  }

  // first version of the game, tailored by Claude from the parent's notes (falls back to the starter)
  const form = { children: kids.map(k => ({ name: String(k.name).slice(0, 40), age: Number(k.age) || null, about: String(k.profile || '').slice(0, 2000) })), goals: String(b.goals || '').slice(0, 3000), image: b.image || null };
  let config = { ...itsyDefault }, notes = 'Started with the standard game. The first review will tailor it to your children.', changelog = 'Starter version';
  try {
    if (env.ANTHROPIC_API_KEY || env.MOCK_CLAUDE_STARTER) {
      const reply = await callClaude({ apiKey: env.ANTHROPIC_API_KEY, model: env.MODEL, mock: env.MOCK_CLAUDE_STARTER }, STARTER_SYSTEM, starterPrompt(form, itsyDefault, 'itsy-big-show'), 8000);
      if (reply.config && !validate(reply.config, itsyDefault).length) { config = reply.config; notes = String(reply.notes_for_parent || ''); changelog = String(reply.changelog || 'Tailored starter').slice(0, 200); }
    }
  } catch { /* keep the starter */ }
  config.version = 1;

  const family = 'f_' + randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10), pinSalt = randomToken(12), now = Date.now();
  const stmts = [
    env.DB.prepare('INSERT INTO families (id, name, pin_salt, pin_hash, dek_wrapped, private_mode, dek_pass_wrapped, pass_salt) VALUES (?,?,?,?,?,?,?,?)')
      .bind(family, await enc(key, String(b.name).slice(0, 80)), pinSalt, await sha256(pinSalt + String(b.pin)), dekWrapped, b.private ? 1 : 0, passWrapped, passSalt),
    env.DB.prepare("INSERT INTO family_games (family_id, game_id, active_version, goals_private, last_review_at) VALUES (?, 'itsy-big-show', 1, ?, ?)").bind(family, await enc(key, form.goals || null), now),
    env.DB.prepare("INSERT INTO game_versions (family_id, game_id, version, config_json, changelog, notes_private, created_by, status, applied_at) VALUES (?, 'itsy-big-show', 1, ?, ?, ?, 'seed', 'live', ?)")
      .bind(family, JSON.stringify(config), changelog, await enc(key, notes), now),
    env.DB.prepare("INSERT INTO playbooks (family_id, game_id, version, content, rationale, status, evidence, applied_at) VALUES (?, 'itsy-big-show', 1, ?, ?, 'live', 0, ?)")
      .bind(family, await enc(key, STARTER_PLAYBOOK), await enc(key, 'Starter playbook before any results.'), now),
    env.DB.prepare('UPDATE users SET family_id = ? WHERE id = ?').bind(family, u.id)
  ];
  for (const k of kids) {
    const label = String(k.label || String(k.name).trim()[0] || '★').slice(0, 4);
    stmts.push(env.DB.prepare('INSERT INTO children (id, family_id, display_name, profile_private, label, age) VALUES (?,?,?,?,?,?)')
      .bind('c_' + randomToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 10), family, await enc(key, String(k.name).trim().slice(0, 40)), await enc(key, String(k.profile || '').slice(0, 2000) || null), label, Number(k.age) || null));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, family, notes });
}

export async function onRequestDelete({ request, env }) {
  const u = await sessionUser(request, env);
  if (!u?.family_id) return json({ error: 'Please sign in.' }, 401);
  const { confirm } = await request.json().catch(() => ({}));
  if (confirm !== 'DELETE') return json({ error: 'Type DELETE to confirm.' }, 400);
  const f = u.family_id;
  const { results: members } = await env.DB.prepare('SELECT id FROM users WHERE family_id = ?').bind(f).all();
  const stmts = ['events', 'voice_clips', 'version_outcomes', 'playbooks', 'improve_runs', 'game_versions', 'family_games', 'children', 'devices', 'family_domains']
    .map(t => env.DB.prepare(`DELETE FROM ${t} WHERE family_id = ?`).bind(f));
  stmts.push(env.DB.prepare('DELETE FROM links WHERE family_id = ?').bind(f));
  for (const m of members) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(m.id), env.DB.prepare('DELETE FROM links WHERE user_id = ?').bind(m.id));
  stmts.push(env.DB.prepare('DELETE FROM users WHERE family_id = ?').bind(f), env.DB.prepare('DELETE FROM families WHERE id = ?').bind(f));
  await env.DB.batch(stmts);
  return json({ ok: true });
}
