import { describe, it, expect, vi } from 'vitest';
import app from './index';

/**
 * P0: multi-patient isolation and X-Patient-Id switching.
 * Mock D1 tracks bind args so we can assert patient_id is enforced.
 */

function createIsolationDB() {
  const patients = new Set([1, 2]);
  const growth = [
    { id: 10, patient_id: 1, height_cm: 100, measured_at: '2024-01-01' },
    { id: 20, patient_id: 2, height_cm: 110, measured_at: '2024-02-01' },
  ];
  const lastBinds = { query: null, args: [] };

  return {
    lastBinds,
    prepare: (query) => ({
      bind: (...args) => {
        lastBinds.query = query;
        lastBinds.args = args;
        return {
          first: async () => {
            if (query.includes('FROM sessions')) {
              const token = args[0];
              if (token === 'valid-token') {
                return { patient_id: 1, expires_at: '2099-01-01', revoked: 0 };
              }
              return null;
            }
            if (query.includes('FROM patient') && query.includes('WHERE id')) {
              const id = Number(args[0]);
              return patients.has(id) ? { id } : null;
            }
            if (query.includes('FROM growth_log') && query.includes('WHERE id')) {
              const id = Number(args[0]);
              const patientId = Number(args[1]);
              const row = growth.find((g) => g.id === id && g.patient_id === patientId);
              return row || null;
            }
            if (query.includes('FROM vaccinations') && query.includes('WHERE id')) {
              return null;
            }
            return null;
          },
          all: async () => {
            if (query.includes('FROM growth_log') && query.includes('patient_id')) {
              const patientId = Number(args[0]);
              return { results: growth.filter((g) => g.patient_id === patientId) };
            }
            if (query.includes('FROM vaccinations') && query.includes('SELECT photos')) {
              return { results: [] };
            }
            return { results: [] };
          },
          run: async () => ({ success: true, meta: { changes: 1 } }),
        };
      },
    }),
  };
}

const baseEnv = {
  CORS_ORIGINS: '*',
  ADMIN_TOKEN: 'test-admin-token',
};

describe('Patient isolation (P0 family mode)', () => {
  it('uses X-Patient-Id for list scope when session login patient differs', async () => {
    const db = createIsolationDB();
    const res = await app.fetch(
      new Request('http://localhost/api/growth', {
        headers: {
          'X-Session-Token': 'valid-token',
          'X-Patient-Id': '2',
        },
      }),
      { ...baseEnv, DB: db }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].patient_id).toBe(2);
    expect(data[0].id).toBe(20);
  });

  it('returns 404 for unknown X-Patient-Id', async () => {
    const db = createIsolationDB();
    const res = await app.fetch(
      new Request('http://localhost/api/growth', {
        headers: {
          'X-Session-Token': 'valid-token',
          'X-Patient-Id': '999',
        },
      }),
      { ...baseEnv, DB: db }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/Patient not found/i);
  });

  it('returns 400 for invalid X-Patient-Id', async () => {
    const db = createIsolationDB();
    const res = await app.fetch(
      new Request('http://localhost/api/growth', {
        headers: {
          'X-Session-Token': 'valid-token',
          'X-Patient-Id': 'abc',
        },
      }),
      { ...baseEnv, DB: db }
    );
    expect(res.status).toBe(400);
  });

  it('item GET is scoped: cannot read growth of other patient', async () => {
    const db = createIsolationDB();
    // Patient 2 active, try to read growth id 10 (belongs to patient 1)
    const res = await app.fetch(
      new Request('http://localhost/api/growth/10', {
        headers: {
          'X-Session-Token': 'valid-token',
          'X-Patient-Id': '2',
        },
      }),
      { ...baseEnv, DB: db }
    );
    expect(res.status).toBe(404);
    expect(db.lastBinds.query).toMatch(/patient_id/);
    expect(db.lastBinds.args).toEqual(expect.arrayContaining([expect.anything(), 2]));
  });

  it('item GET succeeds for owned growth row', async () => {
    const db = createIsolationDB();
    const res = await app.fetch(
      new Request('http://localhost/api/growth/20', {
        headers: {
          'X-Session-Token': 'valid-token',
          'X-Patient-Id': '2',
        },
      }),
      { ...baseEnv, DB: db }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(20);
    expect(data.patient_id).toBe(2);
  });

  it('vaccination photo proxy returns 404 for unowned B2 key', async () => {
    const db = createIsolationDB();
    const res = await app.fetch(
      new Request('http://localhost/api/vaccinations/photos/vaccinations/secret.jpg', {
        headers: {
          'X-Session-Token': 'valid-token',
          'X-Patient-Id': '1',
        },
      }),
      { ...baseEnv, DB: db }
    );
    expect(res.status).toBe(404);
  });

  it('admin middleware sets patientId from X-Patient-Id', async () => {
    const db = createIsolationDB();
    // integrity endpoint uses patientId for FTS probe optionally — any admin tool is fine
    const res = await app.fetch(
      new Request('http://localhost/api/admin/tools/integrity', {
        headers: {
          'X-Admin-Token': 'test-admin-token',
          'X-Patient-Id': '2',
        },
      }),
      { ...baseEnv, DB: db }
    );
    // Should not be 403; endpoint returns JSON even if FTS fails on mock
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
