// Shared helpers for the Cloudflare Pages Functions. Every query is scoped to one family.
export const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export const slug = s => /^[a-z0-9-]{1,40}$/.test(s || '') ? s : null;

// Which family does this site address belong to?
export async function familyFor(request, env) {
  const host = new URL(request.url).hostname.toLowerCase();
  const row = await env.DB.prepare('SELECT family_id FROM family_domains WHERE domain = ?').bind(host).first();
  return row?.family_id || env.DEFAULT_FAMILY || null;
}

export async function familyGame(env, family, game) {
  return env.DB.prepare('SELECT * FROM family_games WHERE family_id = ? AND game_id = ?').bind(family, game).first();
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

// Grown-ups PIN: per-family hash in D1, or the PARENT_PIN secret until one is set.
export async function pinOk(env, family, pin) {
  if (!pin) return false;
  const f = await env.DB.prepare('SELECT pin_salt, pin_hash FROM families WHERE id = ?').bind(family).first();
  if (f?.pin_hash) return (await sha256(f.pin_salt + String(pin))) === f.pin_hash;
  return !!env.PARENT_PIN && String(pin) === String(env.PARENT_PIN);
}

// The improver (GitHub Action) calls /api/internal/* with this token.
export const internalOk = (request, env) => !!env.INTERNAL_TOKEN && request.headers.get('authorization') === `Bearer ${env.INTERNAL_TOKEN}`;

// Start the improver workflow on GitHub for one family's game.
export async function dispatch(env, payload) {
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'kid-games-improver' },
    body: JSON.stringify({ event_type: 'review', client_payload: payload })
  });
  return r.ok ? null : `GitHub refused (${r.status})`;
}

// Read {pin, game} from a grown-ups request and check it. Returns {family, game, body} or a Response.
export async function grownup(request, env) {
  const body = await request.json().catch(() => ({}));
  const family = await familyFor(request, env), game = slug(body.game);
  if (!family || !game || !(await familyGame(env, family, game))) return json({ error: 'Unknown game.' }, 404);
  if (!(await pinOk(env, family, body.pin))) return json({ error: 'Wrong PIN.' }, 403);
  return { family, game, body };
}
