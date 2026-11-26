// Shared helpers for the Cloudflare Pages Functions. Every query is scoped to one family.
export const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export const slug = s => /^[A-Za-z0-9_-]{1,40}$/.test(s || '') ? s : null;

// Signed-in parent (cookie mk_s), or null.
export async function sessionUser(request, env) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)mk_s=([A-Za-z0-9_-]{20,})/);
  if (!m) return null;
  return env.DB.prepare('SELECT u.id, u.family_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha256(m[1]), Date.now()).first();
}
export const randomToken = (n = 24) => { const a = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// Which family is this request for? A linked kid device (x-device header), a signed-in parent, then the site address.
export async function familyFor(request, env) {
  const dev = request.headers.get('x-device');
  if (dev && /^[A-Za-z0-9_-]{20,}$/.test(dev)) {
    const d = await env.DB.prepare('SELECT family_id FROM devices WHERE token_hash = ?').bind(await sha256(dev)).first();
    if (d) return d.family_id;
  }
  const u = await sessionUser(request, env);
  if (u?.family_id) return u.family_id;
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

// A grown-ups request: a signed-in parent of this family, or the family PIN (on the kid's device).
// Returns {family, game, body, user} or a Response.
export async function grownup(request, env) {
  const body = await request.json().catch(() => ({}));
  const family = await familyFor(request, env), game = slug(body.game);
  if (!family || !game || !(await familyGame(env, family, game))) return json({ error: 'Unknown game.' }, 404);
  const user = await sessionUser(request, env);
  if (!(user && user.family_id === family) && !(await pinOk(env, family, body.pin))) return json({ error: 'Wrong PIN.' }, 403);
  return { family, game, body, user };
}

export const cookie = (name, value, maxAgeSec) => `${name}=${value}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;
