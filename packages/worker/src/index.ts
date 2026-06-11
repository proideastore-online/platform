interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type AuthUser = {
  handle: string;
  displayName: string;
  provider: string;
  avatarUrl: string | null;
};

type ContributorRow = {
  id: string;
  handle: string;
  display_name: string;
  role: string;
  reputation: number;
  dossier_count: number;
  note_count: number;
  interest_count: number;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const DOSSIER_STATUSES = new Set(['early', 'concept', 'diligence', 'prototype', 'ready']);
const INTEREST_TYPES = new Set(['watch', 'build', 'fund', 'advise']);
const GRADUATION_TARGETS = new Set(['proappstore', 'progamestore', 'prowebstore', 'proagentstore']);
const AUTH_PREFIX = '/.pis/auth';
const SESSION_COOKIE_NAME = '__Host-pis_session';
const NONCE_COOKIE_NAME = '__Host-pis_auth_nonce';
const AUTH_API_BASE = 'https://api.proappstore.online';
const AUTH_APP_ID = 'proideastore';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const NONCE_TTL_SECONDS = 10 * 60;
const AUTH_PROVIDERS = new Set(['github', 'google']);
const HIDDEN_CONTRIBUTOR_HANDLES = "'system','diligence-lead','builder-scout','investor-reader','cloudflare-smoke'";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...(init.headers || {}) },
  });
}

function bad(message: string, status = 400) {
  return json({ error: message }, { status });
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function pathId(input: string) {
  try {
    const decoded = decodeURIComponent(input);
    return /^[a-z0-9][a-z0-9-]{0,80}$/.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function enumValue(value: unknown, allowed: Set<string>, fallback: string) {
  const normalized = slug(String(value || ''));
  return allowed.has(normalized) ? normalized : fallback;
}

function parseStringArray(value: unknown) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).slice(0, 20) : [];
  } catch {
    return [];
  }
}

async function bodyJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

function sameOriginPath(baseUrl: URL, raw: string | null) {
  if (!raw) return '/';
  try {
    const parsed = new URL(raw, baseUrl.origin);
    if (parsed.origin !== baseUrl.origin) return '/';
    if (parsed.pathname === AUTH_PREFIX || parsed.pathname.startsWith(`${AUTH_PREFIX}/`)) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function cookie(name: string, value: string, maxAge: number) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
}

function clearCookie(name: string) {
  return `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function redirect(location: string, status: 302 | 303, cookies: string[] = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(null, { status, headers });
}

function methodNotAllowed(allow: string) {
  return new Response('Method not allowed', {
    status: 405,
    headers: { ...SECURITY_HEADERS, Allow: allow, 'Cache-Control': 'no-store' },
  });
}

function isSameOriginMutation(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return false;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}

function normalizeAuthUser(payload: unknown): AuthUser | null {
  const data = (payload || {}) as Record<string, unknown>;
  const user = ((data.user || data.profile || data.account || data) || {}) as Record<string, unknown>;
  const email = String(user.email || '');
  const rawHandle = String(user.handle || user.login || user.username || email.split('@')[0] || user.name || '');
  const handle = slug(rawHandle);
  if (!handle) return null;
  return {
    handle,
    displayName: String(user.displayName || user.display_name || user.name || rawHandle).trim() || handle,
    provider: String(user.provider || data.provider || 'auth'),
    avatarUrl: String(user.avatarUrl || user.avatar_url || user.picture || '').trim() || null,
  };
}

async function fetchAuthPayload(token: string) {
  const response = await fetch(`${AUTH_API_BASE}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  return { response, body };
}

async function authUserFor(request: Request) {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
  if (!token) return null;
  try {
    const { response, body } = await fetchAuthPayload(token);
    if (!response.ok) return null;
    return normalizeAuthUser(body);
  } catch {
    return null;
  }
}

async function profileFor(request: Request, env: Env) {
  const authUser = await authUserFor(request);
  const raw = authUser?.handle || request.headers.get('x-idea-handle') || 'guest';
  const handle = slug(raw) || 'guest';
  const profileId = `profile-${handle}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO profiles (id, handle, display_name, role, reputation)
     VALUES (?, ?, ?, 'contributor', 0)`,
  )
    .bind(profileId, handle, authUser?.displayName || handle.replace(/-/g, ' '))
    .run();
  return profileId;
}

async function handleAuth(request: Request, url: URL) {
  if (!url.pathname.startsWith(`${AUTH_PREFIX}/`) && url.pathname !== AUTH_PREFIX) return null;

  if (url.pathname === `${AUTH_PREFIX}/start`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const provider = url.searchParams.get('provider') || 'github';
    if (!AUTH_PROVIDERS.has(provider)) return new Response('unknown provider', { status: 404, headers: SECURITY_HEADERS });
    const returnPath = sameOriginPath(url, url.searchParams.get('return_to') || '/console/');
    const nonce = crypto.randomUUID();
    const callback = new URL(`${AUTH_PREFIX}/callback`, url.origin);
    callback.searchParams.set('return_to', returnPath);
    callback.searchParams.set('nonce', nonce);
    const start = new URL(`/v1/auth/${provider}/start`, AUTH_API_BASE);
    start.searchParams.set('app_id', AUTH_APP_ID);
    start.searchParams.set('return_to', callback.toString());
    start.searchParams.set('response_mode', 'query');
    return redirect(start.toString(), 302, [cookie(NONCE_COOKIE_NAME, nonce, NONCE_TTL_SECONDS)]);
  }

  if (url.pathname === `${AUTH_PREFIX}/callback`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const returnPath = sameOriginPath(url, url.searchParams.get('return_to') || '/console/');
    const nonce = url.searchParams.get('nonce');
    const storedNonce = readCookie(request.headers.get('Cookie'), NONCE_COOKIE_NAME);
    if (!nonce || nonce !== storedNonce) return redirect(`${url.origin}${returnPath}#auth_error=invalid_state`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    const session = url.searchParams.get('session');
    if (!session) return redirect(`${url.origin}${returnPath}#auth_error=missing_session`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    const { response } = await fetchAuthPayload(session);
    if (!response.ok) return redirect(`${url.origin}${returnPath}#auth_error=invalid_session`, 303, [clearCookie(NONCE_COOKIE_NAME)]);
    return redirect(`${url.origin}${returnPath}`, 303, [
      cookie(SESSION_COOKIE_NAME, session, SESSION_TTL_SECONDS),
      clearCookie(NONCE_COOKIE_NAME),
    ]);
  }

  if (url.pathname === `${AUTH_PREFIX}/me`) {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
    if (!token) return json({ error: 'not signed in' }, { status: 401 });
    const { response, body } = await fetchAuthPayload(token);
    const authUser = response.ok ? normalizeAuthUser(body) : null;
    const headers: Record<string, string> = response.ok ? {} : { 'Set-Cookie': clearCookie(SESSION_COOKIE_NAME) };
    return json(authUser ? { user: authUser } : body, { status: response.status, headers });
  }

  if (url.pathname === `${AUTH_PREFIX}/logout`) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (!isSameOriginMutation(request)) return new Response('Forbidden', { status: 403, headers: SECURITY_HEADERS });
    return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE_NAME), 'Cache-Control': 'no-store' } });
  }

  return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
}

async function listDossiers(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT
       d.*,
       COUNT(DISTINCT n.id) AS note_count,
       COUNT(DISTINCT i.id) AS interest_count
     FROM dossiers d
     LEFT JOIN diligence_notes n ON n.dossier_id = d.id
     LEFT JOIN interest_signals i ON i.dossier_id = d.id
     GROUP BY d.id
     ORDER BY d.readiness DESC, d.updated_at DESC`,
  ).all();
  return rows.results || [];
}

async function dossierById(env: Env, dossierId: string) {
  return env.DB.prepare(
    `SELECT
       d.*,
       COUNT(DISTINCT n.id) AS note_count,
       COUNT(DISTINCT i.id) AS interest_count
     FROM dossiers d
     LEFT JOIN diligence_notes n ON n.dossier_id = d.id
     LEFT JOIN interest_signals i ON i.dossier_id = d.id
     WHERE d.id = ?
     GROUP BY d.id`,
  )
    .bind(dossierId)
    .first<Record<string, unknown>>();
}

async function uniqueDossierId(env: Env, title: string) {
  const base = slug(title) || id('dossier');
  const existing = await env.DB.prepare('SELECT id FROM dossiers WHERE id = ?').bind(base).first<{ id: string }>();
  if (!existing) return base;
  return `${base.slice(0, 52)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function listContributors(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT
       p.id,
       p.handle,
       p.display_name,
       p.role,
       p.reputation,
       COUNT(DISTINCT d.id) AS dossier_count,
       COUNT(DISTINCT n.id) AS note_count,
       COUNT(DISTINCT i.id) AS interest_count
     FROM profiles p
     LEFT JOIN dossiers d ON d.created_by = p.id
     LEFT JOIN diligence_notes n ON n.profile_id = p.id
     LEFT JOIN interest_signals i ON i.profile_id = p.id
     WHERE p.handle NOT IN (${HIDDEN_CONTRIBUTOR_HANDLES})
     GROUP BY p.id
     ORDER BY p.reputation DESC, note_count DESC, dossier_count DESC, p.handle ASC
     LIMIT 100`,
  ).all<ContributorRow>();
  return rows.results || [];
}

async function contributorByHandle(env: Env, handle: string) {
  return env.DB.prepare(
    `SELECT
       p.id,
       p.handle,
       p.display_name,
       p.role,
       p.reputation,
       COUNT(DISTINCT d.id) AS dossier_count,
       COUNT(DISTINCT n.id) AS note_count,
       COUNT(DISTINCT i.id) AS interest_count
     FROM profiles p
     LEFT JOIN dossiers d ON d.created_by = p.id
     LEFT JOIN diligence_notes n ON n.profile_id = p.id
     LEFT JOIN interest_signals i ON i.profile_id = p.id
     WHERE p.handle = ? AND p.handle NOT IN (${HIDDEN_CONTRIBUTOR_HANDLES})
     GROUP BY p.id`,
  )
    .bind(handle)
    .first<ContributorRow>();
}

function initials(value: string) {
  const parts = value
    .replace(/[^a-z0-9 -]/gi, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  return (parts[0]?.[0] || 'U').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

function profileStrength(person: ContributorRow) {
  return Math.min(
    100,
    Math.round(
      Number(person.reputation || 0) * 0.24 +
        Number(person.note_count || 0) * 14 +
        Number(person.dossier_count || 0) * 18 +
        Number(person.interest_count || 0) * 7,
    ),
  );
}

function formatDate(value: unknown) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderMix(rows: Array<Record<string, unknown>>, labelKey: string, valueKey: string) {
  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0);
  if (!total) return '<p class="empty">No signal mix yet.</p>';
  return rows
    .map((row) => {
      const label = String(row[labelKey] || 'unknown');
      const count = Number(row[valueKey] || 0);
      const pct = Math.max(4, Math.round((count / total) * 100));
      return `<div class="mix-row"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(count)} event${count === 1 ? '' : 's'}</span></div><i style="width:${pct}%"></i></div>`;
    })
    .join('');
}

function accountAvatar(user: AuthUser, size = 40) {
  const dimension = `${size}px`;
  if (user.avatarUrl) {
    return `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.handle)}" width="${escapeHtml(size)}" height="${escapeHtml(size)}">`;
  }
  return `<span style="width:${dimension};height:${dimension}">${escapeHtml(initials(user.displayName || user.handle))}</span>`;
}

function renderContributorShell(title: string, body: string, request: Request) {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} - ProIdeaStore</title>
<meta name="description" content="ProIdeaStore contributor reputation, dossier work, diligence notes, interest signals, and graduation history.">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}${escapeHtml(new URL(request.url).pathname)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}:root{--accent:#6d28d9;--ruby:#be123c;--paper:#f8fafc;--panel:#fff;--ink:#171322;--muted:#667085;--line:#e4e7ec;--dark:#1f1737}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.5}a{color:inherit;text-decoration:none}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.mark{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:var(--dark);color:#ddd6fe;font-weight:900;box-shadow:inset 0 -4px 0 rgba(190,18,60,.9)}.brand span:last-child{font-family:Fraunces,serif}nav{margin-left:auto;display:flex;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}
.shell{max-width:1120px;margin:0 auto;padding:2rem 1.25rem}.eyebrow{color:var(--accent);font-size:.72rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}h1{font-family:Fraunces,serif;font-size:clamp(2.1rem,5vw,4.2rem);line-height:.98;margin:.45rem 0 1rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.85rem}.profile-grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:1rem;align-items:start}.card,.panel,.hero-card{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:1rem;box-shadow:0 10px 22px rgba(16,24,40,.04)}.hero-card{display:grid;grid-template-columns:88px 1fr;gap:1rem;align-items:center;margin-bottom:1rem}.avatar{display:grid;width:88px;height:88px;place-items:center;border-radius:50%;background:var(--dark);color:#ddd6fe;font-size:1.8rem;font-weight:900;box-shadow:inset 0 -7px 0 rgba(190,18,60,.9)}.card h2,.panel h2{font-size:1rem}.profile-title{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}.profile-title h1{margin:.1rem 0;font-size:clamp(2rem,4vw,3.5rem)}.muted{color:var(--muted);font-size:.88rem}.meta{display:flex;flex-wrap:wrap;gap:.35rem;margin:.65rem 0}.pill{border:1px solid var(--line);border-radius:999px;background:#f5f3ff;color:var(--accent);font-size:.68rem;font-weight:900;padding:.22rem .48rem;text-transform:uppercase}.pill.ruby{background:#fff1f2;color:var(--ruby)}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.45rem;margin-top:.8rem}.stat{border-left:3px solid var(--line);padding-left:.55rem}.stat strong{display:block;font-size:1.05rem}.stat span{color:var(--muted);font-size:.7rem;font-weight:800}.score{display:grid;gap:.35rem}.score strong{font-size:2rem}.meter{height:10px;border-radius:999px;background:#ede9fe;overflow:hidden}.meter i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--ruby))}.list{display:grid;gap:.55rem;margin-top:1rem}.item{border:1px solid var(--line);border-radius:8px;background:#fbfbff;padding:.75rem}.item strong{display:block}.item span,.item time{display:block;color:var(--muted);font-size:.78rem;margin-top:.2rem}.empty{color:var(--muted);font-size:.85rem}.button{display:inline-flex;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;padding:.55rem .7rem;font-size:.78rem;font-weight:900;margin-top:.8rem}.mix{display:grid;gap:.55rem;margin-top:.75rem}.mix-row{display:grid;gap:.32rem}.mix-row div{display:flex;justify-content:space-between;gap:.75rem;font-size:.78rem}.mix-row span{color:var(--muted)}.mix-row i{display:block;height:8px;border-radius:999px;background:var(--accent)}@media(max-width:860px){nav{display:none}.profile-grid{grid-template-columns:1fr}.hero-card{grid-template-columns:64px 1fr}.avatar{width:64px;height:64px;font-size:1.25rem}}@media(max-width:760px){.stats{grid-template-columns:1fr}}
</style>
</head><body><header><a href="/" class="brand"><span class="mark">PI</span><span>ProIdeaStore</span></a><nav><a href="/#dossiers">Dossiers</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a><a href="https://freeideastore.online">FreeIdeaStore</a></nav></header><main class="shell">${body}</main></body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=60' },
  });
}

async function renderContributorsPage(env: Env, request: Request) {
  const contributors = await listContributors(env);
  const cards = contributors
    .map(
      (person) => `<article class="card"><div class="profile-title"><div class="avatar" style="width:48px;height:48px;font-size:1rem">${escapeHtml(initials(person.display_name))}</div><h2><a href="/contributors/${escapeHtml(person.handle)}/">${escapeHtml(person.display_name)}</a></h2></div><div class="meta"><span class="pill">@${escapeHtml(person.handle)}</span><span class="pill">${escapeHtml(person.role)}</span><span class="pill ruby">${escapeHtml(profileStrength(person))} strength</span></div><p>Credibility grows through dossiers, diligence notes, readiness checks, and serious interest signals.</p><div class="stats"><div class="stat"><strong>${escapeHtml(person.dossier_count)}</strong><span>dossiers</span></div><div class="stat"><strong>${escapeHtml(person.note_count)}</strong><span>notes</span></div><div class="stat"><strong>${escapeHtml(person.interest_count)}</strong><span>signals</span></div></div></article>`,
    )
    .join('');
  return renderContributorShell(
    'Contributors',
    `<div class="eyebrow">People behind the diligence</div><h1>Contributor reputation.</h1>${
      cards
        ? `<section class="grid">${cards}</section>`
        : '<section class="panel"><h2>No public contributors yet.</h2><p class="muted">Real profiles appear here after signed-in people create dossiers, add diligence notes, or signal serious interest.</p><a class="button" href="/console/">Open console</a></section>'
    }`,
    request,
  );
}

async function renderContributorPage(env: Env, request: Request, handle: string) {
  const person = await contributorByHandle(env, handle);
  if (!person) return new Response('Contributor not found', { status: 404, headers: SECURITY_HEADERS });
  const dossiers = await env.DB.prepare(
    `SELECT id, title, summary, status, readiness, updated_at
     FROM dossiers
     WHERE created_by = ?
     ORDER BY updated_at DESC
     LIMIT 30`,
  )
    .bind(person.id)
    .all<Record<string, string>>();
  const notes = await env.DB.prepare(
    `SELECT n.kind, n.body, n.created_at, d.id AS dossier_id, d.title AS dossier_title
     FROM diligence_notes n
     JOIN dossiers d ON d.id = n.dossier_id
     WHERE n.profile_id = ?
     ORDER BY n.created_at DESC
     LIMIT 40`,
  )
    .bind(person.id)
    .all<Record<string, string>>();
  const noteMix = await env.DB.prepare(
    `SELECT kind, COUNT(*) AS count
     FROM diligence_notes
     WHERE profile_id = ?
     GROUP BY kind
     ORDER BY count DESC, kind ASC`,
  )
    .bind(person.id)
    .all<Record<string, unknown>>();
  const interestMix = await env.DB.prepare(
    `SELECT type, COUNT(*) AS count
     FROM interest_signals
     WHERE profile_id = ?
     GROUP BY type
     ORDER BY count DESC, type ASC`,
  )
    .bind(person.id)
    .all<Record<string, unknown>>();
  const strength = profileStrength(person);
  return renderContributorShell(
    person.display_name,
    `<section class="hero-card">
      <div class="avatar">${escapeHtml(initials(person.display_name))}</div>
      <div>
        <div class="eyebrow">Contributor profile</div>
        <div class="profile-title"><h1>${escapeHtml(person.display_name)}</h1><span class="pill ruby">${escapeHtml(strength)} strength</span></div>
        <div class="meta"><span class="pill">@${escapeHtml(person.handle)}</span><span class="pill">${escapeHtml(person.role)}</span></div>
        <p class="muted">This profile records dossier authorship, diligence work, builder/investor signals, and readiness judgment.</p>
      </div>
    </section>
    <section class="profile-grid">
      <div>
        <section class="panel"><h2>Public work</h2><div class="stats"><div class="stat"><strong>${escapeHtml(person.dossier_count)}</strong><span>dossiers created</span></div><div class="stat"><strong>${escapeHtml(person.note_count)}</strong><span>diligence notes</span></div><div class="stat"><strong>${escapeHtml(person.interest_count)}</strong><span>interest signals</span></div></div></section>
        <section class="panel" style="margin-top:1rem"><h2>Dossiers</h2><div class="list">${(dossiers.results || []).map((dossier) => `<a class="item" href="/dossiers/${escapeHtml(dossier.id)}/"><strong>${escapeHtml(dossier.title)}</strong><span>${escapeHtml(dossier.status)} / ${escapeHtml(dossier.readiness)} readiness - ${escapeHtml(dossier.summary)}</span><time>${escapeHtml(formatDate(dossier.updated_at))}</time></a>`).join('') || '<p class="empty">No dossiers created yet.</p>'}</div></section>
        <section class="panel" style="margin-top:1rem"><h2>Diligence notes</h2><div class="list">${(notes.results || []).map((item) => `<a class="item" href="/dossiers/${escapeHtml(item.dossier_id)}/"><strong>${escapeHtml(item.kind)} on ${escapeHtml(item.dossier_title)}</strong><span>${escapeHtml(item.body)}</span><time>${escapeHtml(formatDate(item.created_at))}</time></a>`).join('') || '<p class="empty">No diligence notes yet.</p>'}</div></section>
      </div>
      <aside>
        <section class="panel score"><h2>Profile strength</h2><strong>${escapeHtml(strength)}%</strong><div class="meter"><i style="width:${escapeHtml(strength)}%"></i></div><p class="muted">Weighted from reputation, dossiers, diligence notes, and serious watch/build/fund signals.</p></section>
        <section class="panel" style="margin-top:1rem"><h2>Diligence mix</h2><div class="mix">${renderMix(noteMix.results || [], 'kind', 'count')}</div></section>
        <section class="panel" style="margin-top:1rem"><h2>Interest mix</h2><div class="mix">${renderMix(interestMix.results || [], 'type', 'count')}</div></section>
        <section class="panel" style="margin-top:1rem"><h2>Best fit</h2><p class="muted">Invite this person when a dossier needs ${person.note_count ? 'research pressure, risk honesty, prototype framing, or investor-readable evidence' : 'first diligence notes and readiness review'}.</p><a class="button" href="/console/">Create a dossier</a></section>
      </aside>
    </section>`,
    request,
  );
}

async function renderAccountPage(env: Env, request: Request) {
  const user = await authUserFor(request);
  const profile = user ? await contributorByHandle(env, user.handle) : null;
  const publicUrl = user ? `/contributors/${escapeHtml(user.handle)}/` : '/contributors/';
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Profile - ProIdeaStore</title>
<meta name="description" content="Manage your ProIdeaStore account, public profile, appearance, and sign-in state.">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}/profile/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}:root{--accent:#6d28d9;--ruby:#be123c;--paper:#f8fafc;--panel:#fff;--ink:#171322;--muted:#667085;--line:#e4e7ec;--dark:#1f1737;--bad:#dc2626}body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.5}a{color:inherit;text-decoration:none}button{font:inherit}header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.mark{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:var(--dark);color:#ddd6fe;font-weight:900;box-shadow:inset 0 -4px 0 rgba(190,18,60,.9)}.brand span:last-child{font-family:Fraunces,serif}nav{margin-left:auto;display:flex;align-items:center;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}.account-avatar{display:inline-grid;width:36px;height:36px;place-items:center;border:2px solid var(--line);border-radius:50%;overflow:hidden;background:white}.account-avatar img{width:100%;height:100%;object-fit:cover}.account-avatar span{display:grid;place-items:center;border-radius:50%;background:var(--dark);color:#ddd6fe;font-weight:900}.shell{max-width:560px;margin:0 auto;padding:2rem 1.25rem}.identity{display:flex;gap:1rem;align-items:center;margin-bottom:1.5rem}.avatar-large{display:grid;width:72px;height:72px;place-items:center;border-radius:50%;overflow:hidden;background:var(--dark);color:#ddd6fe;font-size:1.5rem;font-weight:900;box-shadow:inset 0 -6px 0 rgba(190,18,60,.9)}.avatar-large img{width:100%;height:100%;object-fit:cover}h1{font-family:Fraunces,serif;font-size:clamp(2rem,5vw,3.2rem);line-height:1}.muted{color:var(--muted);font-size:.88rem}.panel{border:1px solid var(--line);border-radius:8px;background:white;padding:1rem;margin-bottom:1rem;box-shadow:0 10px 22px rgba(16,24,40,.04)}.panel h2{font-size:.95rem;margin-bottom:.75rem}.row{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid var(--line);padding:.7rem 0}.row:first-of-type{border-top:0}.row span{color:var(--muted);font-size:.85rem}.button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;cursor:pointer;padding:.62rem .85rem;font-weight:900}.button.secondary{background:white;color:var(--accent)}.button.danger{border-color:var(--bad);background:white;color:var(--bad)}.seg{display:flex;gap:.5rem;flex-wrap:wrap}.seg button{border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);cursor:pointer;padding:.5rem .65rem;font-weight:800}.seg button.active{border-color:var(--accent);background:#f5f3ff;color:#4c1d95}.danger{border-color:#fecaca}.actions{display:flex;gap:.55rem;flex-wrap:wrap}@media(max-width:760px){nav a:not(.account-avatar){display:none}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="mark">PI</span><span>ProIdeaStore</span></a><nav><a href="/#dossiers">Dossiers</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a>${user ? `<a class="account-avatar" href="/profile/" aria-label="Profile">${accountAvatar(user, 36)}</a>` : `<a href="/console/">Sign in</a>`}</nav></header>
<main class="shell">
  ${
    user
      ? `<section class="identity"><div class="avatar-large">${accountAvatar(user, 72)}</div><div><h1>${escapeHtml(user.displayName)}</h1><p class="muted">@${escapeHtml(user.handle)} / ${escapeHtml(user.provider)} account</p></div></section>
        <section class="panel"><h2>Public profile</h2><div class="row"><strong>Profile page</strong><span>${publicUrl}</span></div><div class="row"><strong>Dossiers</strong><span>${escapeHtml(profile?.dossier_count ?? 0)}</span></div><div class="row"><strong>Diligence notes</strong><span>${escapeHtml(profile?.note_count ?? 0)}</span></div><div class="actions"><a class="button" href="${publicUrl}">Open public profile</a><a class="button secondary" href="/console/">Create dossier</a></div></section>
        <section class="panel"><h2>Appearance</h2><p class="muted" style="margin-bottom:.75rem">Stored on this browser.</p><div class="seg" id="theme-controls"><button data-theme="system">System</button><button data-theme="light">Light</button><button data-theme="dark">Dark</button></div></section>
        <section class="panel"><h2>Account</h2><button class="button secondary" id="logout" type="button">Sign out</button></section>
        <section class="panel danger"><h2>Danger zone</h2><p class="muted" style="margin-bottom:.75rem">Account deletion must be handled by the shared ProAppStore identity service. This store will not fake-delete shared identity data.</p><button class="button danger" type="button" disabled>Delete account unavailable here</button></section>`
      : `<section class="panel"><h1>Profile</h1><p class="muted" style="margin:1rem 0">Sign in to view your profile.</p><div class="actions"><a class="button" href="${AUTH_PREFIX}/start?provider=github&return_to=/profile/">Sign in with GitHub</a><a class="button secondary" href="${AUTH_PREFIX}/start?provider=google&return_to=/profile/">Sign in with Google</a></div></section>`
  }
</main>
<script>
const storedTheme = localStorage.getItem('pis:theme') || 'system';
document.querySelectorAll('[data-theme]').forEach((button) => {
  button.classList.toggle('active', button.dataset.theme === storedTheme);
  button.addEventListener('click', () => {
    localStorage.setItem('pis:theme', button.dataset.theme);
    document.querySelectorAll('[data-theme]').forEach((item) => item.classList.toggle('active', item === button));
  });
});
document.querySelector('#logout')?.addEventListener('click', async () => {
  await fetch('${AUTH_PREFIX}/logout', { method: 'POST' });
  location.href = '/';
});
</script>
</body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function renderConsolePage(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Console - ProIdeaStore</title><meta name="description" content="Create ProIdeaStore opportunity dossiers with GitHub or Google sign-in."><link rel="canonical" href="${escapeHtml(origin)}/console/"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>
*{box-sizing:border-box;margin:0;padding:0}:root{--accent:#6d28d9;--ruby:#be123c;--paper:#f8fafc;--panel:#fff;--ink:#171322;--muted:#667085;--line:#e4e7ec;--dark:#1f1737;--bad:#dc2626}body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.5}a{color:inherit;text-decoration:none}button,input,textarea,select{font:inherit}header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.mark{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:var(--dark);color:#ddd6fe;font-weight:900;box-shadow:inset 0 -4px 0 rgba(190,18,60,.9)}.brand span:last-child{font-family:Fraunces,serif}nav{margin-left:auto;display:flex;align-items:center;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}.account-avatar{display:inline-grid;width:36px;height:36px;place-items:center;border:2px solid var(--line);border-radius:50%;overflow:hidden;background:white}.account-avatar img{width:100%;height:100%;object-fit:cover}.account-avatar span{display:grid;width:100%;height:100%;place-items:center;border-radius:50%;background:var(--dark);color:#ddd6fe;font-weight:900}.shell{max-width:1120px;margin:0 auto;padding:2rem 1.25rem}.eyebrow{color:var(--accent);font-size:.72rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}h1{font-family:Fraunces,serif;font-size:clamp(2.1rem,5vw,4.4rem);line-height:.98;margin:.45rem 0 1rem}.layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:1rem;align-items:start}.panel{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:1rem;box-shadow:0 10px 22px rgba(16,24,40,.04)}.panel h2{font-size:1rem;margin-bottom:.6rem}.muted{color:var(--muted);font-size:.86rem}.auth{display:grid;gap:.5rem}.button{display:inline-flex;justify-content:center;align-items:center;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;cursor:pointer;padding:.65rem .85rem;font-weight:900}.button.secondary{background:white;color:var(--accent)}.button.danger{border-color:var(--bad);background:white;color:var(--bad)}form{display:grid;gap:.75rem}label{display:grid;gap:.3rem;color:var(--muted);font-size:.78rem;font-weight:900;text-transform:uppercase}input,textarea,select{width:100%;border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);padding:.65rem}textarea{min-height:110px;resize:vertical}.split{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.status{border:1px solid var(--line);border-radius:8px;background:#fbfbff;color:var(--muted);padding:.75rem;font-size:.84rem;margin-top:.75rem}.status.ok{border-color:#c4b5fd;color:#4c1d95}.status.err{border-color:#fecaca;color:#991b1b}@media(max-width:840px){.layout{grid-template-columns:1fr}nav{display:none}.split{grid-template-columns:1fr}}</style></head>
<body><header><a href="/" class="brand"><span class="mark">PI</span><span>ProIdeaStore</span></a><nav><a href="/#dossiers">Dossiers</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a><span id="account-slot"></span><a href="https://freeideastore.online">FreeIdeaStore</a></nav></header><main class="shell"><div class="eyebrow">Dossier console</div><h1>Build an opportunity packet.</h1><div class="layout"><section class="panel"><form id="dossier-form"><label>Title<input name="title" required minlength="3" maxlength="140" placeholder="Example: ASX filings analyst"></label><label>Summary<textarea name="summary" required minlength="20" maxlength="1200" placeholder="What is the opportunity, who buys, and what is already known?"></textarea></label><div class="split"><label>Status<select name="status"><option>early</option><option>concept</option><option>diligence</option><option>prototype</option><option>ready</option></select></label><label>Readiness<input type="number" name="readiness" min="0" max="100" value="0"></label></div><label>Type<input name="type" maxlength="60" placeholder="research-saas, community-app, platform"></label><label>Buyer<input name="buyer" maxlength="500" placeholder="Who would pay or seriously engage?"></label><label>Evidence<textarea name="evidence" maxlength="800" placeholder="Sources, pilots, competitor research, prototypes, user interviews."></textarea></label><label>Missing<textarea name="missing" maxlength="800" placeholder="The biggest diligence gaps."></textarea></label><label>Assets<input name="assets" maxlength="500" placeholder="research memo, prototype, pitch deck"></label><label id="guest-label">Guest handle<input name="handle" maxlength="40" placeholder="only used when not signed in"></label><button class="button" type="submit">Create dossier</button></form><div id="status" class="status">Dossiers are attributed to your signed-in profile when available.</div></section><aside class="panel"><h2>Session</h2><p id="session" class="muted">Checking sign-in...</p><div class="auth" id="auth-actions"><a class="button" href="${AUTH_PREFIX}/start?provider=github&return_to=/console/">Sign in with GitHub</a><a class="button secondary" href="${AUTH_PREFIX}/start?provider=google&return_to=/console/">Sign in with Google</a></div></aside></div></main><script>
const form=document.querySelector('#dossier-form');const statusBox=document.querySelector('#status');const sessionBox=document.querySelector('#session');const actions=document.querySelector('#auth-actions');const guestLabel=document.querySelector('#guest-label');const accountSlot=document.querySelector('#account-slot');let signedInUser=null;function setStatus(message,kind=''){statusBox.className='status '+kind;statusBox.textContent=message}function initials(value){return String(value||'U').split(/[\\s-]+/).filter(Boolean).slice(0,2).map((part)=>part[0]).join('').toUpperCase()||'U'}function avatarLink(user){const inner=user.avatarUrl?'<img src="'+user.avatarUrl.replaceAll('"','&quot;')+'" alt="'+user.handle.replaceAll('"','&quot;')+'">':'<span>'+initials(user.displayName||user.handle)+'</span>';return '<a class="account-avatar" href="/profile/" aria-label="Profile">'+inner+'</a>'}async function loadSession(){const response=await fetch('${AUTH_PREFIX}/me').catch(()=>null);if(!response||!response.ok){sessionBox.textContent='Not signed in. You can test with a guest handle, but pro attribution should use GitHub or Google.';accountSlot.innerHTML='<a href="${AUTH_PREFIX}/start?provider=github&return_to=/console/">Sign in</a>';return}const data=await response.json();signedInUser=data.user;sessionBox.textContent='Signed in as @'+signedInUser.handle+' via '+signedInUser.provider+'.';accountSlot.innerHTML=avatarLink(signedInUser);guestLabel.style.display='none';actions.innerHTML='<button class="button danger" id="logout" type="button">Sign out</button>';document.querySelector('#logout').addEventListener('click',async()=>{await fetch('${AUTH_PREFIX}/logout',{method:'POST'});location.reload()})}form.addEventListener('submit',async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());data.assets=String(data.assets||'').split(',').map((item)=>item.trim()).filter(Boolean);const headers={'content-type':'application/json'};if(!signedInUser&&data.handle)headers['x-idea-handle']=data.handle;const response=await fetch('/api/dossiers',{method:'POST',headers,body:JSON.stringify(data)});const result=await response.json().catch(()=>({}));if(!response.ok)return setStatus(result.error||'Could not create dossier.','err');setStatus('Dossier created. Opening the public page...','ok');location.href='/dossiers/'+encodeURIComponent(result.dossier)+'/'});loadSession();
</script></body></html>`, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

async function renderDossierPage(env: Env, request: Request, dossierId: string) {
  const dossier = await dossierById(env, dossierId);
  if (!dossier) return new Response('Dossier not found', { status: 404, headers: SECURITY_HEADERS });
  const notes = await env.DB.prepare(
    `SELECT n.kind, n.body, n.created_at, p.handle, p.display_name, p.role
     FROM diligence_notes n JOIN profiles p ON p.id = n.profile_id
     WHERE n.dossier_id = ?
     ORDER BY n.created_at DESC
     LIMIT 50`,
  )
    .bind(dossierId)
    .all<Record<string, string>>();
  const assets = parseStringArray(dossier.assets_json);
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(dossier.title)} - ProIdeaStore</title>
<meta name="description" content="${escapeHtml(dossier.summary)}">
<link rel="canonical" href="${escapeHtml(new URL(request.url).origin)}/dossiers/${escapeHtml(dossier.id)}/">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--accent:#6d28d9;--ruby:#be123c;--soft:#ede9fe;--paper:#f8fafc;--panel:#fff;--ink:#171322;--muted:#667085;--line:#e4e7ec;--dark:#1f1737}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.55}
a{color:inherit;text-decoration:none}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.logo{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:var(--dark);color:#ddd6fe;box-shadow:inset 0 -4px 0 rgba(190,18,60,.9);font-weight:900}.brand span:last-child{font-family:Fraunces,serif}
nav{margin-left:auto;display:flex;gap:.9rem;color:var(--muted);font-size:.8rem;font-weight:800}
.shell{max-width:1080px;margin:0 auto;padding:2rem 1.25rem}.crumb{color:var(--accent);font-size:.75rem;font-weight:900;text-transform:uppercase;letter-spacing:.1em}
h1{font-family:Fraunces,serif;font-size:clamp(2.1rem,5.8vw,4.5rem);line-height:.96;margin:.45rem 0 .8rem;letter-spacing:0}.lead{max-width:780px;color:var(--muted)}
.meta{display:flex;flex-wrap:wrap;gap:.45rem;margin:1rem 0 1.35rem}.pill{border:1px solid var(--line);border-radius:999px;background:white;color:var(--muted);font-size:.72rem;font-weight:900;padding:.32rem .62rem;text-transform:uppercase}.score{background:var(--soft);color:var(--accent)}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:1rem;align-items:start}.main,.side{border:1px solid var(--line);border-radius:8px;background:white;padding:1rem;box-shadow:0 10px 24px rgba(16,24,40,.04)}
.section{margin-bottom:1rem}.section h2,.notes h2{font-family:Fraunces,serif;font-size:1.35rem;margin-bottom:.35rem}.section p,.note p{color:#344054;font-size:.92rem}.assets{display:flex;flex-wrap:wrap;gap:.35rem}.asset{border-radius:999px;background:#f2f4f7;color:#344054;font-size:.7rem;font-weight:900;padding:.28rem .55rem}.notes{display:grid;gap:.65rem}.note{border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:.75rem}.note strong{display:block;font-size:.75rem;text-transform:uppercase;color:var(--accent)}.note span{display:block;color:var(--muted);font-size:.72rem;margin-bottom:.28rem}
.side{display:grid;gap:.85rem}.side h2{font-size:.82rem;text-transform:uppercase;color:var(--muted);letter-spacing:.1em}.side div{border-left:3px solid var(--line);padding-left:.65rem}.side strong{display:block;font-size:.74rem;text-transform:uppercase}.side span{display:block;color:var(--muted);font-size:.82rem}.button{display:inline-flex;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:white;padding:.58rem .75rem;font-size:.78rem;font-weight:900}
@media(max-width:820px){nav{display:none}.layout{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><a href="/" class="brand"><span class="logo">PI</span><span>ProIdeaStore</span></a><nav><a href="/#dossiers">Dossiers</a><a href="/contributors/">Contributors</a><a href="/console/">Console</a><a href="https://freeideastore.online">FreeIdeaStore</a></nav></header>
<main class="shell">
  <div class="crumb">Curated opportunity dossier</div>
  <h1>${escapeHtml(dossier.title)}</h1>
  <p class="lead">${escapeHtml(dossier.summary)}</p>
  <div class="meta">
    <span class="pill score">${escapeHtml(dossier.readiness)} readiness</span>
    <span class="pill">${escapeHtml(dossier.status)}</span>
    <span class="pill">${escapeHtml(dossier.type)}</span>
  </div>
  <div class="layout">
    <article class="main">
      <section class="section"><h2>Buyer</h2><p>${escapeHtml(dossier.buyer)}</p></section>
      <section class="section"><h2>Evidence</h2><p>${escapeHtml(dossier.evidence)}</p></section>
      <section class="section"><h2>Missing</h2><p>${escapeHtml(dossier.missing)}</p></section>
      <section class="section"><h2>Assets</h2><div class="assets">${assets.map((asset) => `<span class="asset">${escapeHtml(asset)}</span>`).join('')}</div></section>
      <section class="notes"><h2>Diligence Notes</h2>${(notes.results || []).map((note) => `<div class="note"><strong>${escapeHtml(note.kind)}</strong><span>${escapeHtml(note.display_name)} / ${escapeHtml(note.role)}</span><p>${escapeHtml(note.body)}</p></div>`).join('') || '<p>No notes yet.</p>'}</section>
    </article>
    <aside class="side">
      <h2>Deal room signals</h2>
      <div><strong>Notes</strong><span>${escapeHtml(dossier.note_count)} diligence notes</span></div>
      <div><strong>Interest</strong><span>${escapeHtml(dossier.interest_count)} watch/build/fund/advice signals</span></div>
      <div><strong>Source idea</strong><span>${escapeHtml(dossier.source_idea_id || 'Not linked')}</span></div>
      <a class="button" href="/#dossiers">Back to store</a>
    </aside>
  </div>
</main>
</body>
</html>`;
  return new Response(page, {
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

async function handleApi(request: Request, env: Env, url: URL) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });

  if (url.pathname === '/api/health') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM dossiers').first<{ count: number }>();
    return json({ ok: true, service: 'proideastore', dossiers: row?.count ?? 0 });
  }

  if (url.pathname === '/api/session' && request.method === 'GET') {
    const user = await authUserFor(request);
    return user ? json({ user }) : json({ error: 'not signed in' }, { status: 401 });
  }

  if (url.pathname === '/api/dossiers' && request.method === 'GET') {
    return json({ dossiers: await listDossiers(env) });
  }

  const dossierMatch = url.pathname.match(/^\/api\/dossiers\/([^/]+)$/);
  if (dossierMatch && request.method === 'GET') {
    const dossierId = pathId(dossierMatch[1]);
    if (!dossierId) return bad('invalid dossier id', 400);
    const dossier = await dossierById(env, dossierId);
    if (!dossier) return bad('dossier not found', 404);
    return json({ dossier, url: `/dossiers/${dossier.id}/` });
  }

  if (url.pathname === '/api/dossiers' && request.method === 'POST') {
    const input = await bodyJson(request);
    const title = String(input.title || '').trim();
    const summary = String(input.summary || '').trim();
    if (title.length < 3 || summary.length < 20) return bad('title and summary are required');
    const profileId = await profileFor(request, env);
    const dossierId = await uniqueDossierId(env, title);
    await env.DB.prepare(
      `INSERT INTO dossiers
       (id, title, summary, type, status, readiness, buyer, evidence, missing, assets_json, source_idea_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        dossierId,
        title.slice(0, 140),
        summary.slice(0, 1200),
        String(input.type || 'opportunity').slice(0, 60),
        enumValue(input.status, DOSSIER_STATUSES, 'early'),
        clampNumber(input.readiness, 0, 0, 100),
        String(input.buyer || '').slice(0, 500),
        String(input.evidence || '').slice(0, 800),
        String(input.missing || '').slice(0, 800),
        JSON.stringify(Array.isArray(input.assets) ? input.assets.slice(0, 12) : []),
        String(input.sourceIdeaId || '').slice(0, 100),
        profileId,
      )
      .run();
    return json({ dossier: dossierId }, { status: 201 });
  }

  const notesMatch = url.pathname.match(/^\/api\/dossiers\/([^/]+)\/notes$/);
  if (notesMatch && request.method === 'GET') {
    const dossierId = pathId(notesMatch[1]);
    if (!dossierId) return bad('invalid dossier id', 400);
    const rows = await env.DB.prepare(
      `SELECT n.id, n.kind, n.body, n.created_at, p.handle, p.display_name, p.role
       FROM diligence_notes n JOIN profiles p ON p.id = n.profile_id
       WHERE n.dossier_id = ?
       ORDER BY n.created_at DESC`,
    )
      .bind(dossierId)
      .all();
    return json({ notes: rows.results || [] });
  }

  if (notesMatch && request.method === 'POST') {
    const dossierId = pathId(notesMatch[1]);
    if (!dossierId) return bad('invalid dossier id', 400);
    if (!(await dossierById(env, dossierId))) return bad('dossier not found', 404);
    const input = await bodyJson(request);
    const body = String(input.body || '').trim();
    if (body.length < 3) return bad('note body is required');
    const profileId = await profileFor(request, env);
    await env.DB.prepare('INSERT INTO diligence_notes (id, dossier_id, profile_id, kind, body) VALUES (?, ?, ?, ?, ?)')
      .bind(id('note'), dossierId, profileId, String(input.kind || 'note').slice(0, 40), body.slice(0, 2400))
      .run();
    await env.DB.prepare('UPDATE dossiers SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(dossierId)
      .run();
    return json({ ok: true }, { status: 201 });
  }

  const interestMatch = url.pathname.match(/^\/api\/dossiers\/([^/]+)\/interest$/);
  if (interestMatch && request.method === 'POST') {
    const dossierId = pathId(interestMatch[1]);
    if (!dossierId) return bad('invalid dossier id', 400);
    if (!(await dossierById(env, dossierId))) return bad('dossier not found', 404);
    const input = await bodyJson(request);
    const type = String(input.type || '').trim();
    if (!INTEREST_TYPES.has(type)) {
      return bad('interest type must be watch, build, fund, or advise');
    }
    const profileId = await profileFor(request, env);
    await env.DB.prepare('INSERT OR IGNORE INTO interest_signals (id, dossier_id, profile_id, type, note) VALUES (?, ?, ?, ?, ?)')
      .bind(id('interest'), dossierId, profileId, type, String(input.note || '').slice(0, 800))
      .run();
    return json({ ok: true }, { status: 201 });
  }

  const graduationMatch = url.pathname.match(/^\/api\/dossiers\/([^/]+)\/graduations$/);
  if (graduationMatch && request.method === 'POST') {
    const dossierId = pathId(graduationMatch[1]);
    if (!dossierId) return bad('invalid dossier id', 400);
    if (!(await dossierById(env, dossierId))) return bad('dossier not found', 404);
    const input = await bodyJson(request);
    const targetStore = String(input.targetStore || '').trim();
    if (!GRADUATION_TARGETS.has(targetStore)) {
      return bad('targetStore must be a known pro store');
    }
    await env.DB.prepare('INSERT INTO graduation_events (id, dossier_id, target_store, status, note) VALUES (?, ?, ?, ?, ?)')
      .bind(
        id('graduation'),
        dossierId,
        targetStore,
        String(input.status || 'proposed').slice(0, 40),
        String(input.note || '').slice(0, 1000),
      )
      .run();
    return json({ ok: true }, { status: 201 });
  }

  if (url.pathname === '/api/profiles' && request.method === 'GET') {
    return json({ profiles: await listContributors(env) });
  }

  if (url.pathname === '/api/contributors' && request.method === 'GET') {
    return json({ contributors: await listContributors(env) });
  }

  const contributorMatch = url.pathname.match(/^\/api\/contributors\/([^/]+)$/);
  if (contributorMatch && request.method === 'GET') {
    const handle = pathId(contributorMatch[1]);
    if (!handle) return bad('invalid contributor handle', 400);
    const contributor = await contributorByHandle(env, handle);
    if (!contributor) return bad('contributor not found', 404);
    return json({ contributor, url: `/contributors/${contributor.handle}/` });
  }

  return bad('not found', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const authResponse = await handleAuth(request, url);
    if (authResponse) return authResponse;

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    const dossierPageMatch = url.pathname.match(/^\/dossiers\/([^/]+)\/?$/);
    if (dossierPageMatch) {
      try {
        const dossierId = pathId(dossierPageMatch[1]);
        if (!dossierId) return new Response('Dossier not found', { status: 404, headers: SECURITY_HEADERS });
        return await renderDossierPage(env, request, dossierId);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    if (url.pathname === '/console' || url.pathname === '/console/') {
      return renderConsolePage(request);
    }

    if (url.pathname === '/contributors' || url.pathname === '/contributors/') {
      try {
        return await renderContributorsPage(env, request);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    if (url.pathname === '/profile' || url.pathname === '/profile/') {
      try {
        return await renderAccountPage(env, request);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    const contributorPageMatch = url.pathname.match(/^\/(?:contributors|users)\/([^/]+)\/?$/);
    if (contributorPageMatch) {
      try {
        const handle = pathId(contributorPageMatch[1]);
        if (!handle) return new Response('Contributor not found', { status: 404, headers: SECURITY_HEADERS });
        return await renderContributorPage(env, request, handle);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
      }
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
