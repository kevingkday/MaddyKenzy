// GET /api/children -> first names for the "Who's playing?" picker (profiles stay private)
import { json, familyFor } from '../../lib/server.js';
export async function onRequestGet({ request, env }) {
  const family = await familyFor(request, env);
  if (!family) return json({ children: [] });
  const { results } = await env.DB.prepare('SELECT id, display_name FROM children WHERE family_id = ? ORDER BY display_name').bind(family).all();
  return json({ children: results });
}
