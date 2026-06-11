import { describe, expect, it } from 'vitest';
import worker from './index';

type QueryHandler = {
  all?: (binds: unknown[]) => unknown;
  first?: (binds: unknown[]) => unknown;
  run?: (binds: unknown[]) => unknown;
};

class FakeStatement {
  private binds: unknown[] = [];

  constructor(private readonly handler: QueryHandler) {}

  bind(...values: unknown[]) {
    this.binds = values;
    return this;
  }

  all() {
    return Promise.resolve(this.handler.all?.(this.binds) ?? { results: [] });
  }

  first<T>() {
    return Promise.resolve((this.handler.first?.(this.binds) ?? null) as T | null);
  }

  run() {
    return Promise.resolve(this.handler.run?.(this.binds) ?? { success: true });
  }
}

class FakeD1 {
  inserted: unknown[][] = [];
  private readonly dossiers = new Map<string, Record<string, unknown>>();

  constructor(assetsJson = '["research memo","MVP scope","risk memo"]') {
    this.dossiers.set('asx-filings-analyst', {
      id: 'asx-filings-analyst',
      title: 'ASX Filings Analyst',
      summary: 'A citation-first ASX company report analyst.',
      type: 'research-saas',
      status: 'diligence',
      readiness: 72,
      buyer: 'Australian retail investors and small research teams.',
      evidence: 'Competitor review complete.',
      missing: 'Manual pilot with paying users.',
      assets_json: assetsJson,
      source_idea_id: 'asx-filings-analyst',
      created_by: 'profile-system',
      created_at: '2026-06-10 00:00:00',
      updated_at: '2026-06-10 00:00:00',
      note_count: 1,
      interest_count: 1,
    });
  }

  prepare(sql: string) {
    if (sql.includes('SELECT COUNT(*) AS count FROM dossiers')) {
      return new FakeStatement({ first: () => ({ count: this.dossiers.size }) });
    }
    if (sql.includes('FROM dossiers d') && sql.includes('WHERE d.id = ?')) {
      return new FakeStatement({ first: ([id]) => this.dossiers.get(String(id)) ?? null });
    }
    if (sql.includes('FROM dossiers d') && !sql.includes('WHERE d.id = ?')) {
      return new FakeStatement({ all: () => ({ results: Array.from(this.dossiers.values()) }) });
    }
    if (sql.includes('FROM profiles p') && sql.includes('LEFT JOIN dossiers d') && !sql.includes('WHERE p.handle')) {
      return new FakeStatement({
        all: () => ({
          results: [
            {
              id: 'profile-diligence-lead',
              handle: 'diligence-lead',
              display_name: 'Diligence Lead',
              role: 'curator',
              reputation: 220,
              dossier_count: 1,
              note_count: 4,
              interest_count: 1,
            },
          ],
        }),
      });
    }
    if (sql.includes('FROM diligence_notes n JOIN profiles')) {
      return new FakeStatement({
        all: () => ({
          results: [
            {
              kind: 'risk',
              body: 'The investable wedge is citation-backed research workflow.',
              created_at: '2026-06-10 00:00:00',
              handle: 'diligence-lead',
              display_name: 'Diligence Lead',
              role: 'curator',
            },
          ],
        }),
      });
    }
    if (sql.includes('INSERT OR IGNORE INTO profiles')) {
      return new FakeStatement({});
    }
    if (sql.includes('INSERT INTO dossiers')) {
      return new FakeStatement({
        run: (binds) => {
          this.inserted.push(binds);
        },
      });
    }
    return new FakeStatement({});
  }
}

function env(db = new FakeD1()) {
  return {
    DB: db,
    ASSETS: { fetch: () => Promise.resolve(new Response('asset fallback', { status: 404 })) },
  } as unknown as Parameters<typeof worker.fetch>[1] & { DB: FakeD1 };
}

describe('ProIdeaStore worker', () => {
  it('renders hosted dossier pages with assets and diligence notes', async () => {
    const response = await worker.fetch(new Request('https://pis.test/dossiers/asx-filings-analyst/'), env());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(html).toContain('Curated opportunity dossier');
    expect(html).toContain('ASX Filings Analyst');
    expect(html).toContain('research memo');
    expect(html).toContain('The investable wedge is citation-backed research workflow.');
  });

  it('does not break dossier pages when assets_json is malformed', async () => {
    const response = await worker.fetch(new Request('https://pis.test/dossiers/asx-filings-analyst/'), env(new FakeD1('{bad json')));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Curated opportunity dossier');
    expect(html).not.toContain('internal error');
  });

  it('renders contributor directory and console surfaces', async () => {
    const contributors = await worker.fetch(new Request('https://pis.test/contributors/'), env());
    const contributorHtml = await contributors.text();
    const consolePage = await worker.fetch(new Request('https://pis.test/console/'), env());
    const consoleHtml = await consolePage.text();

    expect(contributors.status).toBe(200);
    expect(contributorHtml).toContain('Contributor reputation.');
    expect(contributorHtml).toContain('Diligence Lead');
    expect(consolePage.status).toBe(200);
    expect(consoleHtml).toContain('Create dossier');
    expect(consoleHtml).toContain('Sign in with GitHub');
  });

  it('starts OAuth through the ProAppStore auth API with a nonce cookie', async () => {
    const response = await worker.fetch(new Request('https://pis.test/.pis/auth/start?provider=github&return_to=/console/'), env());
    const location = response.headers.get('location') || '';

    expect(response.status).toBe(302);
    expect(location).toContain('https://api.proappstore.online/v1/auth/github/start');
    expect(location).toContain('app_id=proideastore');
    expect(location).toContain('response_mode=query');
    expect(response.headers.get('set-cookie')).toContain('__Host-pis_auth_nonce=');
  });

  it('creates dossiers through the API with clamped readiness', async () => {
    const testEnv = env();
    const response = await worker.fetch(
      new Request('https://pis.test/api/dossiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idea-handle': 'curator' },
        body: JSON.stringify({
          title: 'Serious Opportunity',
          summary: 'A long enough opportunity summary for a curated pro idea dossier.',
          readiness: 130,
          assets: ['research memo'],
        }),
      }),
      testEnv,
    );
    const data = (await response.json()) as { dossier: string };

    expect(response.status).toBe(201);
    expect(data.dossier).toBe('serious-opportunity');
    expect(testEnv.DB.inserted[0][5]).toBe(100);
  });

  it('rejects invalid ids and writes to missing dossiers', async () => {
    const invalid = await worker.fetch(new Request('https://pis.test/api/dossiers/not%2Fvalid'), env());
    const missingNote = await worker.fetch(
      new Request('https://pis.test/api/dossiers/missing-dossier/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Useful note.' }),
      }),
      env(),
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid dossier id' });
    expect(missingNote.status).toBe(404);
    expect(await missingNote.json()).toEqual({ error: 'dossier not found' });
  });
});
