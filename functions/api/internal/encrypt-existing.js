// POST /api/internal/encrypt-existing (token only) -> one-time upgrade for families created before encryption:
// give each a family key locked with MASTER_KEY, encrypt their private text, and swap name-based child ids for random ones.
// Safe to run repeatedly; already-encrypted values are left alone.
import { json, internalOk, randomToken } from '../../../lib/server.js';
import { masterReady, newDek, lockWithMaster, familyKey, enc, isEnc, b64 } from '../../../lib/crypto.js';
export async function onRequestPost({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  if (!masterReady(env)) return json({ error: env.MASTER_KEY ? 'MASTER_KEY is set but is not 32 bytes (use 44 base64 or 64 hex characters)' : 'MASTER_KEY is not set' }, 503);
  const done = [];
  const { results: fams } = await env.DB.prepare('SELECT id, name, dek_wrapped FROM families WHERE private_mode = 0').all();
  for (const f of fams) {
    let key;
    if (!f.dek_wrapped) {
      const dek = newDek();
      await env.DB.prepare('UPDATE families SET dek_wrapped = ? WHERE id = ?').bind(await lockWithMaster(env, dek), f.id).run();
      key = await familyKey(env, null, b64(dek));
    } else key = await familyKey(env, f.id);
    const e = async v => (v == null || v === '' || isEnc(v)) ? v : await enc(key, v);
    const stmts = [env.DB.prepare('UPDATE families SET name = ? WHERE id = ?').bind(await e(f.name), f.id)];
    for (const c of (await env.DB.prepare('SELECT id, display_name, profile_private, label FROM children WHERE family_id = ?').bind(f.id).all()).results) {
      const id = c.id.startsWith('c_') ? c.id : 'c_' + randomToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
      const label = c.label || (isEnc(c.display_name) ? '?' : String(c.display_name || '?')[0]);
      stmts.push(env.DB.prepare('UPDATE children SET id = ?, display_name = ?, profile_private = ?, label = ? WHERE id = ? AND family_id = ?').bind(id, await e(c.display_name), await e(c.profile_private), label, c.id, f.id));
      if (id !== c.id) stmts.push(env.DB.prepare('UPDATE events SET child_id = ? WHERE child_id = ? AND family_id = ?').bind(id, c.id, f.id));
    }
    for (const g of (await env.DB.prepare('SELECT game_id, goals_private FROM family_games WHERE family_id = ?').bind(f.id).all()).results)
      stmts.push(env.DB.prepare('UPDATE family_games SET goals_private = ? WHERE family_id = ? AND game_id = ?').bind(await e(g.goals_private), f.id, g.game_id));
    for (const v of (await env.DB.prepare('SELECT game_id, version, notes_private FROM game_versions WHERE family_id = ?').bind(f.id).all()).results)
      if (v.notes_private && !isEnc(v.notes_private)) stmts.push(env.DB.prepare('UPDATE game_versions SET notes_private = ? WHERE family_id = ? AND game_id = ? AND version = ?').bind(await e(v.notes_private), f.id, v.game_id, v.version));
    for (const p of (await env.DB.prepare('SELECT game_id, version, content, rationale FROM playbooks WHERE family_id = ?').bind(f.id).all()).results)
      stmts.push(env.DB.prepare('UPDATE playbooks SET content = ?, rationale = ? WHERE family_id = ? AND game_id = ? AND version = ?').bind(await e(p.content), await e(p.rationale), f.id, p.game_id, p.version));
    for (const v of (await env.DB.prepare("SELECT voice_id, hash, text FROM voice_clips WHERE family_id = ? AND text NOT LIKE 'enc:v1:%' AND text != ''").bind(f.id).all()).results)
      stmts.push(env.DB.prepare('UPDATE voice_clips SET text = ? WHERE family_id = ? AND voice_id = ? AND hash = ?').bind(await e(v.text), f.id, v.voice_id, v.hash));
    for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
    done.push({ family: f.id, updates: stmts.length });
  }
  return json({ ok: true, done });
}
