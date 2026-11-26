// Tiny client for the site's private /api/internal endpoints.
for (const k of ['SITE_URL', 'INTERNAL_TOKEN']) if (!process.env[k]) { console.log(`Missing GitHub secret ${k}. Add it under Settings -> Secrets and variables -> Actions.`); process.exit(1); }
export const api = async (path, body) => {
  const r = await fetch(process.env.SITE_URL.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${process.env.INTERNAL_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};
