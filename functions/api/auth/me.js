// GET /api/auth/me -> who is signed in
import { json, sessionUser } from '../../../lib/server.js';
export async function onRequestGet({ request, env }) {
  const u = await sessionUser(request, env);
  if (!u) return json({ user: null });
  const f = u.family_id ? await env.DB.prepare('SELECT id, private_mode FROM families WHERE id = ?').bind(u.family_id).first() : null;
  return json({ user: { id: u.id, role: u.role }, family: f ? { id: f.id, private_mode: !!f.private_mode } : null });
}
