interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const DOSSIER_STATUSES = new Set(['early', 'concept', 'diligence', 'prototype', 'ready']);
const INTEREST_TYPES = new Set(['watch', 'build', 'fund', 'advise']);
const GRADUATION_TARGETS = new Set(['proappstore', 'progamestore', 'prowebstore', 'proagentstore']);

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

async function profileFor(request: Request, env: Env) {
  const raw = request.headers.get('x-idea-handle') || 'guest';
  const handle = slug(raw) || 'guest';
  const profileId = `profile-${handle}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO profiles (id, handle, display_name, role, reputation)
     VALUES (?, ?, ?, 'contributor', 0)`,
  )
    .bind(profileId, handle, handle.replace(/-/g, ' '))
    .run();
  return profileId;
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
:root{--accent:#7c3aed;--soft:#ede9fe;--paper:#f8fafc;--panel:#fff;--ink:#101018;--muted:#667085;--line:#e4e7ec;--dark:#1f1737}
body{background:var(--paper);color:var(--ink);font-family:Manrope,system-ui,sans-serif;line-height:1.55}
a{color:inherit;text-decoration:none}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);padding:.7rem 1.25rem;backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:800}.logo{display:grid;height:34px;width:34px;place-items:center;border-radius:8px;background:var(--accent);color:white}.brand span:last-child{font-family:Fraunces,serif}
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
<header><a href="/" class="brand"><span class="logo">I</span><span>ProIdeaStore</span></a><nav><a href="/#dossiers">Dossiers</a><a href="https://freeideastore.online">FreeIdeaStore</a></nav></header>
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

  return bad('not found', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
