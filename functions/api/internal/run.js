// POST /api/internal/run {family, run, status, message} -> record how a run ended (token only)
import { json, slug, internalOk } from '../../../lib/server.js';
export async function onRequestPost({ request, env }) {
  if (!internalOk(request, env)) return json({ error: 'no' }, 401);
  const b = await request.json();
  if (!['no_change', 'failed'].includes(b.status)) return json({ error: 'bad status' }, 400);
  await env.DB.prepare('UPDATE improve_runs SET status = ?, message = ?, finished_at = unixepoch() WHERE id = ? AND family_id = ?')
    .bind(b.status, String(b.message || '').slice(0, 300), Number(b.run) || 0, slug(b.family)).run();
  return json({ ok: true });
}
