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
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

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

async function handleApi(request: Request, env: Env, url: URL) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });

  if (url.pathname === '/api/health') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM dossiers').first<{ count: number }>();
    return json({ ok: true, service: 'proideastore', dossiers: row?.count ?? 0 });
  }

  if (url.pathname === '/api/dossiers' && request.method === 'GET') {
    return json({ dossiers: await listDossiers(env) });
  }

  if (url.pathname === '/api/dossiers' && request.method === 'POST') {
    const input = await bodyJson(request);
    const title = String(input.title || '').trim();
    const summary = String(input.summary || '').trim();
    if (title.length < 3 || summary.length < 20) return bad('title and summary are required');
    const profileId = await profileFor(request, env);
    const dossierId = slug(title) || id('dossier');
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
        String(input.status || 'early').slice(0, 40),
        Math.max(0, Math.min(100, Number(input.readiness || 0))),
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
    const rows = await env.DB.prepare(
      `SELECT n.id, n.kind, n.body, n.created_at, p.handle, p.display_name, p.role
       FROM diligence_notes n JOIN profiles p ON p.id = n.profile_id
       WHERE n.dossier_id = ?
       ORDER BY n.created_at DESC`,
    )
      .bind(notesMatch[1])
      .all();
    return json({ notes: rows.results || [] });
  }

  if (notesMatch && request.method === 'POST') {
    const input = await bodyJson(request);
    const body = String(input.body || '').trim();
    if (body.length < 3) return bad('note body is required');
    const profileId = await profileFor(request, env);
    await env.DB.prepare('INSERT INTO diligence_notes (id, dossier_id, profile_id, kind, body) VALUES (?, ?, ?, ?, ?)')
      .bind(id('note'), notesMatch[1], profileId, String(input.kind || 'note').slice(0, 40), body.slice(0, 2400))
      .run();
    await env.DB.prepare('UPDATE dossiers SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(notesMatch[1])
      .run();
    return json({ ok: true }, { status: 201 });
  }

  const interestMatch = url.pathname.match(/^\/api\/dossiers\/([^/]+)\/interest$/);
  if (interestMatch && request.method === 'POST') {
    const input = await bodyJson(request);
    const type = String(input.type || '').trim();
    if (!['watch', 'build', 'fund', 'advise'].includes(type)) {
      return bad('interest type must be watch, build, fund, or advise');
    }
    const profileId = await profileFor(request, env);
    await env.DB.prepare('INSERT OR IGNORE INTO interest_signals (id, dossier_id, profile_id, type, note) VALUES (?, ?, ?, ?, ?)')
      .bind(id('interest'), interestMatch[1], profileId, type, String(input.note || '').slice(0, 800))
      .run();
    return json({ ok: true }, { status: 201 });
  }

  const graduationMatch = url.pathname.match(/^\/api\/dossiers\/([^/]+)\/graduations$/);
  if (graduationMatch && request.method === 'POST') {
    const input = await bodyJson(request);
    const targetStore = String(input.targetStore || '').trim();
    if (!['proappstore', 'progamestore', 'prowebstore', 'proagentstore'].includes(targetStore)) {
      return bad('targetStore must be a known pro store');
    }
    await env.DB.prepare('INSERT INTO graduation_events (id, dossier_id, target_store, status, note) VALUES (?, ?, ?, ?, ?)')
      .bind(
        id('graduation'),
        graduationMatch[1],
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

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

