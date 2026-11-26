// GET /api/children -> what the "Who's playing?" picker shows: each child's label, plus first name in standard mode
import { json, familyFor } from '../../lib/server.js';
import { familyKey, dec } from '../../lib/crypto.js';
export async function onRequestGet({ request, env }) {
  const family = await familyFor(request, env);
  if (!family) return json({ children: [] });
  const f = await env.DB.prepare('SELECT private_mode FROM families WHERE id = ?').bind(family).first();
  const key = f && !f.private_mode ? await familyKey(env, family) : null;
  const { results } = await env.DB.prepare('SELECT id, display_name, label FROM children WHERE family_id = ? ORDER BY created_at').bind(family).all();
  const children = [];
  for (const c of results) { const name = key ? await dec(key, c.display_name) : (f?.private_mode ? null : c.display_name); children.push({ id: c.id, label: c.label || (name || '?')[0], display_name: name || c.label || '?' }); }
  return json({ children, private: !!f?.private_mode });
}
